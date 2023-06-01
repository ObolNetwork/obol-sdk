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

const client: Client = new Client({ baseUrl: 'https://obol-api-dev.gcp.obol.tech' }, signer);

client.createCluster({
  name: "testSDK",
  num_validators: 1,
  operators:
    [
      { address: "0x86B8145c98e5BD25BA722645b15eD65f024a87EC" },
      { address: "0x4123c277dfcBdDDC3585fDb10c0cEE3cE9BBBCf1" },
      { address: "0x367C266b94Bf9c213b2A9C61b5915E2a493533C8" },
      { address: "0x3C75594181e03E8ECD8468A0037F058a9dAfad79" }
    ],
  validators: [{
    fee_recipient_address: "0x3CD4958e76C317abcEA19faDd076348808424F99",
    withdrawal_address: "0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e"
  }],
})
  .then((link: any) => {
    console.log(link, "inviteLink")
  }).catch((err: any) => { console.log(err); });







