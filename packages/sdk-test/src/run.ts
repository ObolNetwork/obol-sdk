import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';

const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

const provider = ethers.getDefaultProvider("goerli", {
  infura: infuraProjectId,
});

const wallet = new ethers.Wallet("replace_with_private_key");

const signer = wallet.connect(provider);





(async () => {

  const client: Client = new Client({ baseUrl: 'https://obol-api-dev.gcp.obol.tech' }, signer);

  client.createCluster({
    name: "testSDK",
    uuid: "30a4ea89-4693-481a-bba7-a314025e1633",
    config_hash: "0xeb99f244ca6e7ea963c10a4b81c5f604fd8250cdfc1e01221f4d92686cd436fb",
    creator:
    {
      address: "0x86B8145c98e5BD25BA722645b15eD65f024a87EC"
    },
    dkg_algorithm: "default",
    fork_version: "0x00001020",
    num_validators: 1,
    operators:
      [
        { address: "0x86B8145c98e5BD25BA722645b15eD65f024a87EC" },
        { address: "0x4123c277dfcBdDDC3585fDb10c0cEE3cE9BBBCf1" },
        { address: "0x367C266b94Bf9c213b2A9C61b5915E2a493533C8" },
        { address: "0x3C75594181e03E8ECD8468A0037F058a9dAfad79" }
      ],
    threshold: 3,
    timestamp: "2023-03-28T11:44:04.350Z",
    validators: [{
      fee_recipient_address: "0x3CD4958e76C317abcEA19faDd076348808424F99",
      withdrawal_address: "0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e"
    }],
    version: "v1.5.0"
  }, signer)
    .then((c: any) => {
      console.log(`Created new cluster with creator address ${c.creator.address}`);
      client.deleteCluster("0xeb99f244ca6e7ea963c10a4b81c5f604fd8250cdfc1e01221f4d92686cd436fb")
        .then(() => {
          console.log(`Cluster is deleted`);
        });
    }).catch((err: any) => { console.log(err); });

})();

//0xd6e8dfe49ad2337472ba791ad7e89060dd5eda1fd805407a9f7f0ad8b3da4d4a533d21074bd87afebaa659b36f44b7168f15d9de010738244ec05adcc8398dea1c





