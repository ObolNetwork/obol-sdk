import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';
import request from 'supertest';

describe('Create Cluster Definition', () => {
  it('should return lockhash', async () => {
    const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

    const provider = ethers.getDefaultProvider("goerli", {
      infura: infuraProjectId,
    });

    const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

    const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

    const wallet = new ethers.Wallet(privateKey);

    const signer = wallet.connect(provider);

    const client: Client = new Client({}, signer);

    const lockHash = await client.createClusterDefinition({
      name: "testSDK",
      num_validators: 1,
      operators:
        [
          { address: "0xC35CfCd67b9C27345a54EDEcC1033F2284148c81" },
          { address: "0x33807D6F1DCe44b9C599fFE03640762A6F08C496" },
          { address: "0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f" },
          { address: "0x86B8145c98e5BD25BA722645b15eD65f024a87EC" }
        ],
      validators: [{
        fee_recipient_address: "0x3CD4958e76C317abcEA19faDd076348808424F99",
        withdrawal_address: "0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e"
      }],
    })
    console.log(lockHash,"lockHash")
    expect(lockHash).toHaveLength(66);
  });

  // Add more tests here
});


//   .then((configHash: string) => {
//   console.log(configHash)
//   return client.getClusterLock(configHash)

// }).then((lock: any) => {
//   console.log(lock, "lockFile")

// }).catch((err: any) => { console.log(err); });







