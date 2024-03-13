
export const enr =
  'enr:-HW4QLlrtMjFLGkFT1bwdGbvZQlH8hLi0M2g44JAxEYP3BZmYpcsy9Q56HPPD87fMucjvLv4-obEFacpsg0ehRilbHeAgmlkgnY0iXNlY3AyNTZrMaEDRaa5o2aSgqyFq_ERZcQTztrOij1mFtXX1bJuVI6ieak'

// v1.7.0

export const clusterConfigV1X7 = {
  name: 'testSDK',
  operators: [
    { address: '0xC35CfCd67b9C27345a54EDEcC1033F2284148c81' },
    { address: '0x33807D6F1DCe44b9C599fFE03640762A6F08C496' },
    { address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f' },
    { address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC' },
  ],
  validators: [
    {
      fee_recipient_address: '0x3CD4958e76C317abcEA19faDd076348808424F99',
      withdrawal_address: '0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e',
    },
  ],
}

export const clusterLockV1X7 = {
  cluster_definition: {
    name: 'v1.7.0 group test',
    creator: {
      address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      config_signature:
        '0x269aefc773de5fbfe41001cbd160b62747a27d76a92c8a6a7eae19d0f172c4b44d445ee0992e1ba6e271740a59051bf9cd8fda4042572bde75e40e8d28f7e6561b',
    },
    operators: [
      {
        address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        enr: 'enr:-Iu4QCdreXm-iHrd2Y-QgLAHeGAkQSrZNvfPL-l6IuGEuKoMHnZsg93EgIWWOtcBzKs_-skexEKvY3CmcJ8SOzMIGMiAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4r6dX8heIruf3OW_hfcctLtsaX8roj8E-8s0-IpH9rYN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x73bc8d23dee307a02791339300b6405573e686c22222d6e6c8fe349f52bb8c0620ea1ed476fe569ed8c8d21751893216b248eb28dd4de7aa263a234efe3129181b',
        enr_signature:
          '0x1dc963f01eb794170e35a972ec8b487bdea2e3c1acbbe2fc2ab7936e7fe99e407583489a7dff3fbb08f4902e77867d795a7196a83d91b0a0eb8e50b8d96d35ba1c',
      },
      {
        address: '0xC35CfCd67b9C27345a54EDEcC1033F2284148c81',
        enr: 'enr:-Iu4QNbiUUUwT18LynBbVPJhNxvzQsaSpUr40mQTWscnZaqKb6vAlvV8j-eDDR3E0wjMQumGRbGm2IAb5_k4bVWJiVGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPOiodUji0ohgJb5sNK1hgv8g6xO5_znZz3NkkBkyYyKIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x0ab6f58c612cd0c6af395769132fccc5c0804fd40cc395ae7ab2069a7aedb2884f2fa07a91eee57e13c3407dbeeb81b2256312d14006bdb1c19d4206b66899a41c',
        enr_signature:
          '0xb580f1380a62d299587357181561c8db8d67f4cc92d094b2ca3c84eddde3759567cfe60669b30ef55308a749c3c6a32f52148ac6b667cc6554f63a04c55350451b',
      },
      {
        address: '0x33807D6F1DCe44b9C599fFE03640762A6F08C496',
        enr: 'enr:-Iu4QJyserRukhG0Vgi2csu7GjpHYUGufNEbZ8Q7ZBrcZUb0KqpL5QzHonkh1xxHlxatTxrIcX_IS5J3SEWR_sa0ptGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQMAUgEqczOjevyculnUIofhCj0DkgJudErM7qCYIvIkzIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x6f4f030aedba854cc4fa626171038e0125a93b3c3017af932d5b2a159076d0e17c1641f28cb58c29039e2c33074dd729c3198253ea17cc38074274f5e13676441b',
        enr_signature:
          '0xf63195e4238eac6d9deae5ec56626ac16a7a861294587c3ee144853ace76f8a2089980a2cbf17c72a8c5ac0651c6935d023db34fc0be58a91f0c70c26017597a1b',
      },
      {
        address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
        enr: 'enr:-HW4QKJTwXC6Chw6zbnA3HFZi6Jo0DkIgjKy4eUBpsSOGnAeWE6ChEjEyk_6R6Qrm7jI-iqfs3_HYxiKde8vFgvHHrCAgmlkgnY0iXNlY3AyNTZrMaECfFKQH4spdZCHqrKVz1Q02xYla6J_RQECDNNYBRWdzv8',
        config_signature:
          '0x8c09f7163c20cd0a2d28cb4fbfda22e93bc53bc537f6143407065922a25e40ab39f52b232ecb9241b3e1674f87a16d263181a17a80de55fb92b9659211428b581b',
        enr_signature:
          '0x05d801705908933b7d1566f48f5726d36874423b1bbdd3f582e08c754220d211492b46ee434f1d1f5bd1507f80f9ca1df569354892e7d2eda87861bc2279be6e1c',
      },
    ],
    uuid: 'a1d642aa-07ed-4d48-9eda-0e70cb4bb03f',
    version: 'v1.7.0',
    timestamp: '2023-07-18T10:36:04.505Z',
    num_validators: 1,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x00001020',
    config_hash:
      '0x4c3e37cbdb2fb850150f6e112c4ea03cdc388bff059081182659b3407183b431',
    definition_hash:
      '0xe7bf484f38a45c96e9a3fac60d3e39b88eeb9979fad983e06b0ec90e90aa20b3',
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0xb61b17f3b6425eb2636bc6378de0ed8aab918c3346b59d297828e7c74643d51e80edc2b41290c568614cfb80d2b0be34',
      public_shares: [
        '0xab6c1448221f664c145a4a574302fd4419ccfe1178487b2fa4629ee9fc2999c43188c96a52ad795074124a7eb0f63841',
        '0x8a2a265fbe9854b1532be335272717a5650e19ecc4d6ea54ed8d8d239200f5b860e5710f7a3b9f5d8a100782cbaf4ede',
        '0xa8a0aaf1119afe1c2b21d7dbf18bbe107586dc49028d285886c2e7f2bcf3f1c6817fff1250f4a4a370229a0266ea9bff',
        '0x93f62a042d304bbb316761712f5a39a9d549c71275e5d891afa3688b9224ebfa3bfd22f8b76f31d8ad88f65812b27dc3',
      ],
      deposit_data: {
        pubkey:
          '0xb61b17f3b6425eb2636bc6378de0ed8aab918c3346b59d297828e7c74643d51e80edc2b41290c568614cfb80d2b0be34',
        withdrawal_credentials:
          '0x01000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
        amount: '32000000000',
        signature:
          '0xae016c6c42daa8d1517d0e10370cf7882b28149635f734c5f3d83f781cd61f5df6d5203ec11bd0ca9d9e51c6030b66330476a93a65de6151d110e0f6482591f53678d863e55392e9cfb55fecac537edac51979790bcde38250a141348f116d46',
        deposit_data_root:
          'fbada6c7c4cba867780eead34c1462339795fe9b417db466ce2f9d4822e8a4bb',
      },
      builder_registration: {
        message: {
          fee_recipient: '0x86b8145c98e5bd25ba722645b15ed65f024a87ec',
          gas_limit: 30000000,
          timestamp: 1616508000,
          pubkey:
            '0xb61b17f3b6425eb2636bc6378de0ed8aab918c3346b59d297828e7c74643d51e80edc2b41290c568614cfb80d2b0be34',
        },
        signature:
          '0xb1de0eeb44c3b9d598d50c8d48a676e45dd63a5a3040caa34e34ab8c60d0b2f079419d8699c97e76b641326845c99ee309096de1878547e370d4b82e2e4e580650fee2e46dc7b9b3bd805b7fe6f95ba6a9e2734c3ddd23bf6b1f5597e9a3f834',
      },
    },
  ],
  signature_aggregate:
    '0x90c32196e4dda81b39faaaec283e3ec5620b7c25c1a35949d54eb53a7c1c5a3963614c0d147085d82f9c52f550556ba406c0c5c8a4cec3fec825e6663a8792a9205f1a36fdde3e8c810cfd8861963190dd9b9eadd9a803bd5765c0b93d146542',
  lock_hash:
    '0xdb19ef9c0677713f55502448b7c63d58fb25c81d34a5a8ce07a19bcfb3a9c0a0',
  node_signatures: [
    '0xa5230ba0586b21d49e790bc99304dc2245f8222c17d456ef60b848e3b0c5541d61825b2f9c2bda87ba3952979f28f6ba2338026603de74f925d9603aa823d42f01',
    '0xc22ac5dc3a6f98471f2f25d11fd48600f955f68cb940e9da6789ab8fc50ca1bf40c8fb3200132ad6b2c66be7e256979fe182f8f924506ad8ba2c827401038ec600',
    '0xebd08c9ece21abd78cfe82bc32eae68ccd77fc1e96e56ce93679918c5adcb2c92564a4fa609d7649587fbfb0c581403da8553e9e62c910e5ae589625704aa02b00',
    '0xa07fc8f89f32a5b2551cc2173b0486f86142ee2a67400d2d4a956a2b948da96b58adddf558db6ac84de62242b5e56b1a1e95d26451be3a922fe3929f2a367a7400',
  ],
}

// v1.8.0
export const clusterConfigV1X8 = {
  name: 'testSDK',
  operators: [
    { address: '0xC35CfCd67b9C27345a54EDEcC1033F2284148c81' },
    { address: '0x33807D6F1DCe44b9C599fFE03640762A6F08C496' },
    { address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f' },
    { address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC' },
  ],
  validators: [
    {
      fee_recipient_address: '0x3CD4958e76C317abcEA19faDd076348808424F99',
      withdrawal_address: '0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e',
    },
  ],
  deposit_amounts: [
    "8000000000",
    "16000000000",
    "8000000000"
],
}

export const clusterLockV1X8 = {
  cluster_definition: {
      name: "test cluster",
      creator: {
          address: "0x5050A4F4b3f9338C3472dcC01A87C76A144b3c9c",
          config_signature: "0x03b41a12847064090333026a10bc0c6f9c51400e67b414fe74aa7df91388583d6bea930d525478e25d85aa49f3c649723e4158895fadd0e787fe8579d43c18cb00"
      },
      operators: [
          {
              "address": "0x5050A4F4b3f9338C3472dcC01A87C76A144b3c9c",
              "enr": "enr:-HW4QIHPUOMb34YoizKGhz7nsDNQ7hCaiuwyscmeaOQ04awdH05gDnGrZhxDfzcfHssCDeB-esi99A2RoZia6UaYBCuAgmlkgnY0iXNlY3AyNTZrMaECTUts0TYQMsqb0q652QCqTUXZ6tgKyUIzdMRRpyVNB2Y",
              "config_signature": "0xffafd355831aa993e5a019419403d61533649edc546b4f497bc305d7620dcb787756f9748be1ea76f7236692faeff7c1d2e7b06bf89894d07518de2d4ff45b4d00",
              "enr_signature": "0x20b5b4ba720053c6ea35a710cdd9d81440ae3a69c204edb06184ea2328ff3a290bd00c256d71f6f4daed2f995931b38c3f6bd0b17796f4e121278073e049086800"
          },
          {
              "address": "0x3325a78425F17a7E487Eb5666b2bFd93aBb06c70",
              "enr": "enr:-HW4QDztNDqgEPAgJoHkcF4LfXyjXUo1r_xYoNv48H0PFItwYx-OnviqgfHxEz51RDOGvUMiTpXyo0HBjK5ZZ8YxS9WAgmlkgnY0iXNlY3AyNTZrMaECUx_mBoE0UD0nIxMyJ8hnrI-myDxTfppEw8W9vcsf4zc",
              "config_signature": "0x2053ba17731221d4ed919de72010b559a924143f74998c94b71e95cb1fdbe3a05ad0cbdf61cf174ef3509ce86bc03633f5215065d71f93bd15e1e506db71420e00",
              "enr_signature": "0x9aa50b499754e19b7e30e12d6b2d63abc916edc7810aae9f3427f7d2a3cc33ad10f84d638ccb73817cd6a6eee311a52d45ea24f0d0f5452dc845ef24749e71ca00"
          },
          {
              "address": "0xc48B812bB43401392c037381AcA934F4069C0517",
              "enr": "enr:-HW4QGSS-HN3zRfCJGISFmDT59Cpo-daC4U2vSjqPZWegHVSJklFsDs0f1fF_E7X4q8NUbR3bWDlX7IifsjQ_Xrm7QuAgmlkgnY0iXNlY3AyNTZrMaEDRid5rUqtOVFGFHUacQhfLxDhx6WT5OAw77W4chzlWws",
              "config_signature": "0xa08dcb9c91fe562fb24862ba4ccd8ec881436e5563182d819d0eb1d1e4293ef40fd7e03094f5ed5c5165101cdb009ccab7eee813f01530f4f81a180d11f61cce01",
              "enr_signature": "0x6ecb15dda256fd34ea09a04db6c140387790d6902509df81fabab3889de4980f30c5d07480b12a0d4f3c6f75f56fe8c0f2b344311e092f53cd959367c5d67f7201"
          }
      ],
      uuid: "8D019192-C242-24E2-CAFC-CAE3A61FB586",
      version: "v1.8.0",
      timestamp: "2024-03-07T17:05:34+03:00",
      num_validators: 2,
      threshold: 3,
      validators: [
          {
              fee_recipient_address: "0x52fdfc072182654f163f5f0f9a621d729566c74d",
              withdrawal_address: "0x81855ad8681d0d86d1e91e00167939cb6694d2c4"
          },
          {
              fee_recipient_address: "0xeb9d18a44784045d87f3c67cf22746e995af5a25",
              withdrawal_address: "0x5fb90badb37c5821b6d95526a41a9504680b4e7c"
          }
      ],
      dkg_algorithm: "frost",
      fork_version: "0x00001020",
      deposit_amounts: [
          "8000000000",
          "16000000000",
          "8000000000"
      ],
      config_hash: "0xe604bdf1649e2bcc5399149d4a683feacfc5678abe990d75e202791984208c53",
      definition_hash: "0x123be6c24ec74366b0a318de42d36e09a43a08c3db72800698a958510c804a0b"
  },
  distributed_validators: [
      {
          distributed_public_key: "0x87382e8cc3e2c9c2d03ac1af7ae0bcc1be468c596a8a8b8059153ca9ce7746d459dd0603858e858355cb96d67a2a87a7",
          public_shares: [
              "0x804841f5b773b7cda35f2ceaacbd7b52afba38b6d65d5c4b3b1d3cdc905c21c0f7d1ac18cd4847b0cf56ac7ed41d5c19",
              "0xac2362cbfdd573137a5f46727981363198c8a8b66eb29123014f3e1dee335132973973bddb4a4c592c8c74ff270b5982",
              "0xb63dd0fb59a513b0f9f10ed3d88a54aa72c189faf2c2d2e4d66a81730a81a89d6feac0ff8e7b6b488c5131aa33845b47"
          ],
          builder_registration: {
              message: {
                  fee_recipient: "0x52fdfc072182654f163f5f0f9a621d729566c74d",
                  gas_limit: 30000000,
                  timestamp: 1616508000,
                  pubkey: "0x87382e8cc3e2c9c2d03ac1af7ae0bcc1be468c596a8a8b8059153ca9ce7746d459dd0603858e858355cb96d67a2a87a7"
              },
              signature: "0x8a8085f002d0332c689baef8ecbab1ca3632e2536fa9f0587212f50429a4617d1cac1722b55d521ffb58424f6bc4f9640bdd1994e9abaff1fe00ea641aabf89249a8ed64aee5f7508a78dc9a6e2fa626cc707e5f9f94b9634084ea825c082b79"
          },
          partial_deposit_data: [
              {
                  pubkey: "0x87382e8cc3e2c9c2d03ac1af7ae0bcc1be468c596a8a8b8059153ca9ce7746d459dd0603858e858355cb96d67a2a87a7",
                  withdrawal_credentials: "0x01000000000000000000000081855ad8681d0d86d1e91e00167939cb6694d2c4",
                  amount: "8000000000",
                  signature: "0x84614b278beed177d17f8e61ec6c4c4c17fb41adde71dedb5977ce19354a4ec24bed65021109d7d690d014fc531cf7040b3285877c8bfc35b1a2dd64fdbcab086132982fb036c31071824ea9ec6ca28ff6aaf86a425350c2bec8012b399342eb"
              },
              {
                  pubkey: "0x87382e8cc3e2c9c2d03ac1af7ae0bcc1be468c596a8a8b8059153ca9ce7746d459dd0603858e858355cb96d67a2a87a7",
                  withdrawal_credentials: "0x01000000000000000000000081855ad8681d0d86d1e91e00167939cb6694d2c4",
                  amount: "16000000000",
                  signature: "0xac5bcb369e8dde110604f6ae829a3432f82a99b0a996e15f4be6426acbe690a1aadb4b365d8b10a36737b2cd8c7f561214d4e4df3626cc9664f663111d15efbd8d18cffff5c3eff407fe2cc478244caea7f9f2afee83a0ae8aa2587365b8e54a"
              }
          ]
      },
      {
          distributed_public_key: "0x90b5773dc3dc11480a7ebf68005980ca26be65fad6565ce655f0a9e24083a7ad2e22d7102368a8292fcd18021272a87a",
          public_shares: [
              "0x898c28241cb2386fdbfa26ee08fcc804ee953695741691d4f8c45a36f08dd319a09173a9ef632eb7a35f94ff9241cd8e",
              "0xb7d73b8ea0d74dc7eb70f305c6666dd9dca749ea1084b25f942e0d0909211f6556c2955266a7ff54a204146676bf1c8c",
              "0x8fbe3bb3c23e9dcb093ee45a28efc120ee2a923d4c62a0377d0a6ed7a3da8fa185456bbaec41e13fd84a2a410023a742"
          ],
          builder_registration: {
              message: {
                  fee_recipient: "0xeb9d18a44784045d87f3c67cf22746e995af5a25",
                  gas_limit: 30000000,
                  timestamp: 1616508000,
                  pubkey: "0x90b5773dc3dc11480a7ebf68005980ca26be65fad6565ce655f0a9e24083a7ad2e22d7102368a8292fcd18021272a87a"
              },
              signature: "0xa941fcec27add0165a1bd76bb4b5d3a5f4e96e0e7b9a9edad4188dda914b97519c71f5964a467061cfee91f317eaa321174d5dbd8e94a6486c62e8bd10aad6ead7494696e2926b68fea446b9d868abde763a177083e87921d5e1b09c6b2aec2a"
          },
          partial_deposit_data: [
              {
                  pubkey: "0x90b5773dc3dc11480a7ebf68005980ca26be65fad6565ce655f0a9e24083a7ad2e22d7102368a8292fcd18021272a87a",
                  withdrawal_credentials: "0x0100000000000000000000005fb90badb37c5821b6d95526a41a9504680b4e7c",
                  amount: "8000000000",
                  signature: "0x88b20e744a83679da4df81416358214f1e62535498b9ac38eb622b01cad2090554b2f1f7b3ac9032c15ccd31fffbb1cf0f5589b7703ecc4441e5bd7bf7c388ac1423c41b5c76cbee9969ffade054edcd1a883f80df813b52786393d318db007b"
              },
              {
                  pubkey: "0x90b5773dc3dc11480a7ebf68005980ca26be65fad6565ce655f0a9e24083a7ad2e22d7102368a8292fcd18021272a87a",
                  withdrawal_credentials: "0x0100000000000000000000005fb90badb37c5821b6d95526a41a9504680b4e7c",
                  amount: "16000000000",
                  signature: "0x94d9db7b4527e6eb308d387f168089a51d1deffc2c985faf1f7f8e82fbc9cb93c7f10c6a7bbca4fc25a1cfc95de28432037cf7727c1db0ad6d1fb0f1813d5904fba4ab8aebfeccfcded2f915bd48fb46155131b24adb0ba5e764d7ff6d3c82a5"
              }
          ]
      }
  ],
  signature_aggregate: "0xb54fc9fcfe6827f519a29ff0a8bc9a06aafd197253a6def9f45bf79b023e71f3bd26bd0365f0beb7d60c1146e33be127161eb034af4a4de619e9d6971174224fdc18c04821d9e5b7abaeaedc01755b6e33addb2dc820aa361890a634a0252422",
  lock_hash: "0x1f598e309b715ba0141034b495975e3bed0231ad92da49dfff462765049df671",
  node_signatures: [
      "0xf4317dc1f01738f84b2624866e8b4e85e92394fabb49218ef8a6dfe7ee4fdaab015742379328b173204504332a5e15450d5a127bbe8b8a2209cd9fa12b85cf4501",
      "0x9e4726f7cce4cfad963eb04aaeec677fa7d1010d66640867d0ee11c75fad45dd6ad8fad9ad4a3c042bd1ab298a5598896b9de08acfde476f9aa65c48e3def7f901",
      "0x54a89155ef4a6e319c0411f29963554fe551abce6d8463661cc5449a67243d053292f0190432cdcbcfc6e651815b093d55b4adbfc8c82f85ee1e1af798d9bae400"
  ]
}


