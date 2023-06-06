import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';

const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

const provider = ethers.getDefaultProvider("goerli", {
  infura: infuraProjectId,
});

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

const wallet = new ethers.Wallet(privateKey);

const signer = wallet.connect(provider);

const client: Client = new Client({}, signer);

client.createCluster({
  name: "testSDK",
  num_validators: 1,
  operators:
    [
      { address: "" },
      { address: "" },
      { address: "" },
      { address: "" }
    ],
  validators: [{
    fee_recipient_address: "0x3CD4958e76C317abcEA19faDd076348808424F99",
    withdrawal_address: "0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e"
  }],
})
  .then((link: any) => {
    console.log(link.split("#")[1], "inviteLink")
   return client.getClusterDtls(link.split("#")[1])

  }).then((lock: any) => {
    console.log(lock, "lockFile")

  }).catch((err: any) => { console.log(err); });







