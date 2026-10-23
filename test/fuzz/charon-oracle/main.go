// Command charon-oracle runs Charon's own cluster-lock verification on lock
// files, for the SDK differential fuzz harness (test/fuzz).
//
// Modes (one input per stdin line, one JSON result per stdout line):
//
//	charon-oracle lock     each line is a path to a case file {"lock": {...}, ...}
//	                       or a bare cluster-lock.json
//	charon-oracle decode   each line is a hex G1 point (herumi deserialisation)
//
// "lock" mirrors cluster.LoadClusterLock (what `charon run`, `charon exit *`,
// `charon deposit *`, `charon combine` do on load): json.Unmarshal into
// cluster.Lock, then Lock.VerifyHashes, then Lock.VerifySignatures. It also
// reports, separately and NOT part of Charon's load-time verdict, a
// deposit-data check built from Charon's own DKG primitives
// (deposit.NewMessage, deposit.GetMessageSigningRoot, tbls.Verify, the DKG's
// deposit amount list) so the SDK's step 6 can be compared like-for-like.
package main

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	eth2p0 "github.com/attestantio/go-eth2-client/spec/phase0"
	"github.com/herumi/bls-eth-go-binary/bls"

	"github.com/obolnetwork/charon/app/eth1wrap"
	"github.com/obolnetwork/charon/cluster"
	"github.com/obolnetwork/charon/eth2util"
	"github.com/obolnetwork/charon/eth2util/deposit"
	"github.com/obolnetwork/charon/tbls"
	"github.com/obolnetwork/charon/tbls/tblsconv"
)

type lockResult struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Stage string `json:"stage,omitempty"` // read | unmarshal | hashes | signatures | panic
	Err   string `json:"err,omitempty"`
	// Charon's hashes of the parsed lock (when it parsed).
	ConfigHash     string `json:"config_hash,omitempty"`
	DefinitionHash string `json:"definition_hash,omitempty"`
	LockHash       string `json:"lock_hash,omitempty"`
	// Deposit-data check from Charon's DKG primitives (not run on load).
	DepositOK  *bool  `json:"deposit_ok,omitempty"`
	DepositErr string `json:"deposit_err,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: charon-oracle lock|decode < input")
		os.Exit(2)
	}
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 1<<30)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	enc := json.NewEncoder(out)

	switch os.Args[1] {
	case "lock":
		eth1 := eth1wrap.NewDefaultEthClientRunner("")
		for in.Scan() {
			line := strings.TrimSpace(in.Text())
			if line == "" {
				continue
			}
			_ = enc.Encode(verifyFile(line, eth1))
			out.Flush()
		}
	case "decode":
		for in.Scan() {
			line := strings.TrimSpace(in.Text())
			if line == "" {
				continue
			}
			_ = enc.Encode(decodeG1(line))
		}
	default:
		fmt.Fprintln(os.Stderr, "unknown mode", os.Args[1])
		os.Exit(2)
	}
}

func verifyFile(path string, eth1 eth1wrap.EthClientRunner) (res lockResult) {
	res.ID = path
	raw, err := os.ReadFile(path)
	if err != nil {
		return lockResult{ID: path, Stage: "read", Err: err.Error()}
	}
	var wrapper struct {
		Lock json.RawMessage `json:"lock"`
	}
	if json.Unmarshal(raw, &wrapper) == nil && len(wrapper.Lock) > 0 {
		raw = wrapper.Lock
	}
	return verifyLock(path, raw, eth1)
}

func verifyLock(id string, raw []byte, eth1 eth1wrap.EthClientRunner) (res lockResult) {
	res.ID = id
	stage := "unmarshal"
	defer func() {
		if r := recover(); r != nil {
			res.OK = false
			res.Stage = "panic"
			res.Err = fmt.Sprintf("panic in %s: %v", stage, r)
		}
	}()

	var lock cluster.Lock
	if err := json.Unmarshal(raw, &lock); err != nil {
		res.Stage, res.Err = stage, err.Error()
		return res
	}

	// Charon's own hashes (for hash cross-checks with the SDK).
	func() {
		defer func() { _ = recover() }()
		if d, err := lock.Definition.SetDefinitionHashes(); err == nil {
			res.ConfigHash = "0x" + hex.EncodeToString(d.ConfigHash)
			res.DefinitionHash = "0x" + hex.EncodeToString(d.DefinitionHash)
		}
		if l, err := lock.SetLockHash(); err == nil {
			res.LockHash = "0x" + hex.EncodeToString(l.LockHash)
		}
	}()

	// Deposit check from Charon's DKG primitives (reported separately).
	func() {
		defer func() {
			if r := recover(); r != nil {
				f := false
				res.DepositOK, res.DepositErr = &f, fmt.Sprintf("panic: %v", r)
			}
		}()
		ok := true
		if err := depositCheck(lock); err != nil {
			ok = false
			res.DepositErr = err.Error()
		}
		res.DepositOK = &ok
	}()

	// cluster.LoadClusterLock, without --no-verify.
	stage = "hashes"
	if err := lock.VerifyHashes(); err != nil {
		res.Stage, res.Err = stage, err.Error()
		return res
	}
	stage = "signatures"
	if err := lock.VerifySignatures(eth1); err != nil {
		res.Stage, res.Err = stage, err.Error()
		return res
	}
	res.OK = true
	return res
}

// depositCheck: what Charon's DKG checks before it writes a deposit into the
// lock (dkg.go signAndAggDepositData / aggDepositData), applied to the lock:
// for every validator, one deposit per (deduplicated) definition amount, each
// built by deposit.NewMessage from the definition's withdrawal address,
// amount and compounding flag (which enforces 1 ETH <= amount <= max), with
// the lock's pubkey / credentials equal to the built message and the group
// signature verifying over Charon's signing root.
func depositCheck(lock cluster.Lock) error {
	network, err := eth2util.ForkVersionToNetwork(lock.ForkVersion)
	if err != nil {
		return fmt.Errorf("network: %w", err)
	}
	amounts := lock.DepositAmounts
	if len(amounts) == 0 {
		if cluster.SupportPartialDeposits(lock.Version) {
			amounts = deposit.DefaultDepositAmounts(lock.Compounding)
		} else {
			amounts = []eth2p0.Gwei{deposit.DefaultDepositAmount}
		}
	} else {
		amounts = deposit.DedupAmounts(amounts)
	}
	if len(lock.ValidatorAddresses) < len(lock.Validators) {
		return fmt.Errorf("validator addresses: %d < %d", len(lock.ValidatorAddresses), len(lock.Validators))
	}
	for i, val := range lock.Validators {
		present := map[eth2p0.Gwei]bool{}
		for _, dd := range val.PartialDepositData {
			present[eth2p0.Gwei(dd.Amount)] = true
		}
		for _, a := range amounts {
			if !present[a] {
				return fmt.Errorf("validator %d: deposit amount %d missing", i, a)
			}
		}
		if len(val.PartialDepositData) == 0 {
			return fmt.Errorf("validator %d: no deposit data", i)
		}
		if len(val.PubKey) != 48 {
			return fmt.Errorf("validator %d: pubkey length", i)
		}
		for j, dd := range val.PartialDepositData {
			msg, err := deposit.NewMessage(eth2p0.BLSPubKey(val.PubKey), lock.ValidatorAddresses[i].WithdrawalAddress, eth2p0.Gwei(dd.Amount), lock.Compounding)
			if err != nil {
				return fmt.Errorf("validator %d deposit %d: %w", i, j, err)
			}
			if !bytes.Equal(dd.PubKey, val.PubKey) {
				return fmt.Errorf("validator %d deposit %d: pubkey", i, j)
			}
			if !bytes.Equal(dd.WithdrawalCredentials, msg.WithdrawalCredentials) {
				return fmt.Errorf("validator %d deposit %d: withdrawal credentials", i, j)
			}
			root, err := deposit.GetMessageSigningRoot(msg, network)
			if err != nil {
				return fmt.Errorf("validator %d deposit %d: %w", i, j, err)
			}
			pk, err := tblsconv.PubkeyFromBytes(val.PubKey)
			if err != nil {
				return fmt.Errorf("validator %d deposit %d: %w", i, j, err)
			}
			sig, err := tblsconv.SignatureFromBytes(dd.Signature)
			if err != nil {
				return fmt.Errorf("validator %d deposit %d: %w", i, j, err)
			}
			if err := tbls.Verify(pk, root[:], sig); err != nil {
				return fmt.Errorf("validator %d deposit %d: %w", i, j, err)
			}
		}
	}
	return nil
}

type decodeResult struct {
	Input        string `json:"input"`
	OK           bool   `json:"ok"`
	Err          string `json:"err,omitempty"`
	Reserialized string `json:"reserialized,omitempty"`
	Zero         bool   `json:"zero,omitempty"`
	ValidOrder   bool   `json:"valid_order,omitempty"`
}

func decodeG1(h string) (res decodeResult) {
	res.Input = h
	defer func() {
		if r := recover(); r != nil {
			res.OK, res.Err = false, fmt.Sprintf("panic: %v", r)
		}
	}()
	_ = tbls.SetImplementation // ensure tbls init (herumi Init + ETH mode) ran
	b, err := hex.DecodeString(strings.TrimPrefix(h, "0x"))
	if err != nil {
		res.Err = err.Error()
		return res
	}
	var pk bls.PublicKey
	if err := pk.Deserialize(b); err != nil {
		res.Err = err.Error()
		return res
	}
	res.OK = true
	res.Reserialized = "0x" + hex.EncodeToString(pk.Serialize())
	res.Zero = pk.IsZero()
	res.ValidOrder = pk.IsValidOrder()
	return res
}
