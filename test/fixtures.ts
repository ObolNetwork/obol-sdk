import { ZeroAddress } from 'ethers';

// Test address constants for OVM splits
export const TEST_ADDRESSES = {
  REWARD_RECIPIENT_1: '0x1234567890123456789012345678901234567890',
  REWARD_RECIPIENT_2: '0x2345678901234567890123456789012345678901',
  PRINCIPAL_RECIPIENT_1: '0x3456789012345678901234567890123456789012',
  PRINCIPAL_RECIPIENT_2: '0x4567890123456789012345678901234567890123',
  OVM_OWNER: '0x5678901234567890123456789012345678901234',
  SPLIT_OWNER: '0x6789012345678901234567890123456789012345',
  PRINCIPAL_RECIPIENT: '0x7890123456789012345678901234567890123456',
  ZERO_ADDRESS: ZeroAddress,
} as const;

export const enr =
  'enr:-HW4QLlrtMjFLGkFT1bwdGbvZQlH8hLi0M2g44JAxEYP3BZmYpcsy9Q56HPPD87fMucjvLv4-obEFacpsg0ehRilbHeAgmlkgnY0iXNlY3AyNTZrMaEDRaa5o2aSgqyFq_ERZcQTztrOij1mFtXX1bJuVI6ieak';

// v1.6.0
export const clusterLockV1X6 = {
  cluster_definition: {
    name: 'test v.1.6',
    creator: {
      address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      config_signature:
        '0x705534bdce89175379a6c0e346d93adc1bfa41552bcb5cecfcc7b20c0663c6c1188aa09352b9085b2c7c0644d4506838234eebbbacba3caac2f6c227de050a821c',
    },
    operators: [
      {
        address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        enr: 'enr:-Iu4QCdreXm-iHrd2Y-QgLAHeGAkQSrZNvfPL-l6IuGEuKoMHnZsg93EgIWWOtcBzKs_-skexEKvY3CmcJ8SOzMIGMiAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQL4r6dX8heIruf3OW_hfcctLtsaX8roj8E-8s0-IpH9rYN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0xbcbec314ce8a54c784069006dc23dd897696402487bdae982601ca1fdbc565af35a7d2e682f6051b3fe1c90f51ee5f908bec4d6a3ba0c29068316c85538d5e041c',
        enr_signature:
          '0x1dc963f01eb794170e35a972ec8b487bdea2e3c1acbbe2fc2ab7936e7fe99e407583489a7dff3fbb08f4902e77867d795a7196a83d91b0a0eb8e50b8d96d35ba1c',
      },
      {
        address: '0xC35CfCd67b9C27345a54EDEcC1033F2284148c81',
        enr: 'enr:-Iu4QNbiUUUwT18LynBbVPJhNxvzQsaSpUr40mQTWscnZaqKb6vAlvV8j-eDDR3E0wjMQumGRbGm2IAb5_k4bVWJiVGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPOiodUji0ohgJb5sNK1hgv8g6xO5_znZz3NkkBkyYyKIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0xb95ccbca31a648a642ab2e273a0d66743921f0e9c67a5122fc229f0898ca4a1e7ac0b5b8698dfc6f3eccad7000f5aabc53666cd8b4cc7272abeb3f407571ac111c',
        enr_signature:
          '0xb580f1380a62d299587357181561c8db8d67f4cc92d094b2ca3c84eddde3759567cfe60669b30ef55308a749c3c6a32f52148ac6b667cc6554f63a04c55350451b',
      },
      {
        address: '0x33807D6F1DCe44b9C599fFE03640762A6F08C496',
        enr: 'enr:-Iu4QJyserRukhG0Vgi2csu7GjpHYUGufNEbZ8Q7ZBrcZUb0KqpL5QzHonkh1xxHlxatTxrIcX_IS5J3SEWR_sa0ptGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQMAUgEqczOjevyculnUIofhCj0DkgJudErM7qCYIvIkzIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x59f7173b7f7eaa6f9a3619b508241ae4b8788ce64b23554eb2057b15d1570ed56ed25fd9d98321ffb6b30f119b8802f626f3ed78665b9b272e6f650412de37af1c',
        enr_signature:
          '0xf63195e4238eac6d9deae5ec56626ac16a7a861294587c3ee144853ace76f8a2089980a2cbf17c72a8c5ac0651c6935d023db34fc0be58a91f0c70c26017597a1b',
      },
      {
        address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
        enr: 'enr:-HW4QKJTwXC6Chw6zbnA3HFZi6Jo0DkIgjKy4eUBpsSOGnAeWE6ChEjEyk_6R6Qrm7jI-iqfs3_HYxiKde8vFgvHHrCAgmlkgnY0iXNlY3AyNTZrMaECfFKQH4spdZCHqrKVz1Q02xYla6J_RQECDNNYBRWdzv8',
        config_signature:
          '0x6458cc392ec9824a3713efb7469907b2ba9956b0729d1a080ef86bd092748f294e9a24e9176bfa95975c8426ea94159699df4f54b636708013a24b74483b30d91c',
        enr_signature:
          '0x05d801705908933b7d1566f48f5726d36874423b1bbdd3f582e08c754220d211492b46ee434f1d1f5bd1507f80f9ca1df569354892e7d2eda87861bc2279be6e1c',
      },
    ],
    uuid: 'f96771cf-290a-430f-8a8a-f999f5e9d35b',
    version: 'v1.6.0',
    timestamp: '2023-05-19T14:52:22.655Z',
    num_validators: 1,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x3C75594181e03E8ECD8468A0037F058a9dAfad79',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x00001020',
    config_hash:
      '0xd50651bc2ae522e3d473a07ebf86c4486de0d479ce8881be0572019cf319a974',
    definition_hash:
      '0xac4ffb5a5f50bbfafac4e320f52a63f77bf3ced1b78b00b5635f488d9efa8576',
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0xa29529bcf747faedd53b4e1a8f6181ed55fad34f5eb3376ce65d444c0ecf79fab761bcd8607d12ad79f72bae537e6d38',
      public_shares: [
        '0x94cfd584f8b1ea26944d4339c19d8552a7fa4326dddc16a9f15a9ea962f2cdc09bf5b58f10f90de95afac218daa2fb93',
        '0x95a727a6975e1eaad3504e6252a0840ad042ae0b46e8f7a8139341883e0d6d1e983dbf334a02efea93828daecb9fc9e7',
        '0x8c38f9ed7cf995759a60f1d173671e420eb78d763ea139b7f3d5858283f9cbf05e682721330d2c6dc91389fe9db0397b',
        '0xa36b7f0d46e29107c70350cb605bd22718c1c8af890dabed7c875e9c0c9f7727eb190b01e04ce16e1c954427ef4e8b56',
      ],
      deposit_data: {
        pubkey:
          '0xa29529bcf747faedd53b4e1a8f6181ed55fad34f5eb3376ce65d444c0ecf79fab761bcd8607d12ad79f72bae537e6d38',
        withdrawal_credentials:
          '0x0100000000000000000000003c75594181e03e8ecd8468a0037f058a9dafad79',
        amount: '32000000000',
        signature:
          '0x8a7ee66acd9d5200c26dd644f3275a2847dd000330d509a9a94f7338c4f38dc7533e2ad70f6a3f10339a2e74a5ac94c518ce62efb8b01eb46f4b44f853d74e194c9eb8c4af34f9a29d3ece7cfdd916c2d6b5013717919e5fe91dd95bd3ae4852',
      },
    },
  ],
  signature_aggregate:
    '0xb7f49e8eaa4015a3118deace6d17c9aef8a495b0ce460b0f1d27423101177000541a9d422fcc4eeedbaaa2497c555d8d0ba7ee882a5eaecfb89e7dcec2f2f3f5df78bc172e03be426c5f0835cbe58dac43e5812de5c21d2755693de2af80f491',
  lock_hash:
    '0x6d2b38d098143c8f0bc5076f4e9b6081cbba040a5aea6649e6223e7a4131241b',
};

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
};

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
      },
      builder_registration: {
        message: {
          fee_recipient: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
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
};

// Hoodi solo cluster lock v1.10.0 (from obol-api soloClusterLockPayloadV1X10 / soloClusterLockV1X10)
export const clusterLockV1X8 = {
  cluster_definition: {
    name: 'test v1.10.0',
    creator: {
      address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
      config_signature:
        '0xd4090fc4132ecf6cd56a37710f160acb51b8e4aa504315c3d6986ecd2abb69740c5a50ec9a7d71dbabb73de481b7daa1b971a584dae70cf4bfcb6b9f6dc04e351c',
    },
    operators: [
      {
        address: '',
        enr: 'enr:-HW4QJUBzWvvnSN2O99fLB7kow0GP5xU422_Hyi-67osOTDsS_UHK12S17SneN0NRpZwsm4LHR1mhGJ5AdrIYBUpe6eAgmlkgnY0iXNlY3AyNTZrMaEDrKLEo5F6CKmxy1nx3hsZQl0Rf7b03bNOw79Cqk9Ypkw',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QA2ylL3bOPp1IUWlSR_tCgpu2joJmzOnsHeFstgLbUmFKGCwUdLI9hwfSpWmUPBhy5a7oGUoNMzTaDYw4CctJyyAgmlkgnY0iXNlY3AyNTZrMaECv_ZRMEIKJpG5Ad_7BLWTADlso6NBBRaYRW2-4SLTETg',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QOWgkhcDv-mhAPEwDU-oPU_jZUVX5so8oL1HPId47eOaTxA0E1Dw2952IaAcWeO3Ca1aKRVGGzg_nvDR8aUkC6GAgmlkgnY0iXNlY3AyNTZrMaECQraJ27oeh45H9eGruHLZqM5y3XOTEn-vzaYtuvE0kc8',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QGhRGiP0Ln-lnJGK5z7TFjkbTTNIt3Yjw9j9rCdYwwSVNTfl4lee_SvhFH4hE0Z86kFPx_QbjcA1mlJ1fDxLHtCAgmlkgnY0iXNlY3AyNTZrMaECdQkt0MeC3BztdCy9oBhMflqt4F4e7fRj5kI_cnp_XX0',
        config_signature: '',
        enr_signature: '',
      },
    ],
    uuid: 'f4633f88-590e-4037-a351-e0b1479efd8a',
    version: 'v1.10.0',
    timestamp: '2025-04-04T10:17:42.897Z',
    num_validators: 1,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
        withdrawal_address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x10000910',
    deposit_amounts: ['32000000000'],
    config_hash:
      '0x7b779e7f923d60f07dccc992db4380240b3ecdda4065f1e024b9472afe0153e9',
    definition_hash:
      '0xff27e97b6cde0399cbced126e4b57caa7a7899253836db5f86fd4c11a0c8d079',
    consensus_protocol: 'qbft',
    target_gas_limit: 30000000,
    compounding: true,
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0xa999c018bf0bd74da8d0e5266e3fc5a18f2301ea06ed7cdf1b7979c8a5f81645f842058ea073a88d6047a7e4bd5ad3d5',
      public_shares: [
        '0x825e0e4af8517ecd3e307df1f601c43abc39d924cddc8ac82d9df7c25ad6cc6841d2de54350df8637be8b21aef60e32e',
        '0x861901a6db82b41123037eb25835057656510cb14cf7bbfd7ff2237f4079ed18b9ac0b32b4a2375be8ddfbf2fb55c0bd',
        '0x8ae1ae77a44ae45c25aada4a90f4d83d7cedfa506ad1ef2e4f4918f0a86a84b36e7eb164053103b9c9c4108cdd5ace44',
        '0xb5657224952e2d1ba802a15a3b01e7c84b88158d1d94d5b99b08081788fe38d2fc52b6d4c69060073deb333e0398679f',
      ],
      partial_deposit_data: [
        {
          pubkey:
            '0xa999c018bf0bd74da8d0e5266e3fc5a18f2301ea06ed7cdf1b7979c8a5f81645f842058ea073a88d6047a7e4bd5ad3d5',
          withdrawal_credentials:
            '0x020000000000000000000000f6ff1a7a14d01e86a175ba958d3b6c75f2213966',
          amount: '32000000000',
          signature:
            '0xac57e83ce968cbcc1dee8542b144c3b046f311fa497d938433c028fbc20feeea1a3debdc9dd018cae1a027e8f2225062045a2e7d8431db3ea9ef094a1a717e4eb1e1411acae85f574f73d38c68b20c0782650f2b8be0220c98db9a2aa0d389af',
          deposit_data_root:
            '81a6247371958d48d65a1c9462f3fa7fabd34958b2060e0e4709c43ba2b85120',
        },
      ],
      builder_registration: {
        message: {
          fee_recipient: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
          gas_limit: 36000000,
          timestamp: 1742213400,
          pubkey:
            '0xa999c018bf0bd74da8d0e5266e3fc5a18f2301ea06ed7cdf1b7979c8a5f81645f842058ea073a88d6047a7e4bd5ad3d5',
        },
        signature:
          '0xb64c06aa2881edc725adea7a401aa935013add84a2faea9ed1c9ad19d94c4d5d5f8af93839fd503d50ee35162fa9266a147986aeb3d4bc85d652e50f69a481179cd768164742b2f77757c627d0d6c1ebeeb90cd5f64b93a51f08641b7ac9fbe9',
      },
    },
  ],
  signature_aggregate:
    '0xb53eca1af80192800b2a2295332d9ec025d29f9b02ace60332a702ae3c2e64ec4859f36bf364f53e9176e97df642254707e3468287981cf3aca78981c8295455203e187995d5fb78f8cc8d763dda20d6af3254c20a398fc8f3246272c88aeb65',
  lock_hash:
    '0xf58f9c03adfbaec0e33a58f9870ec6d586cc8803a349c479fc77258630584418',
  node_signatures: [
    '0xca9842748c84753944860f3d65bad704f8facd97b7033fc38f775bb9ce19f9343dcd05ec0ee4cd151b6dc2d7a892084dc9435a52046e714212f9fdc71a465a5300',
    '0xc123da33d91c7e4cf4a825fea3be16e6df3c38947cfa2ff446aaab8e4e92a63f5583d91d06bfeb0bce6bb0170f03d42e3dce8dbf97b8c789fdbddcac646daf0e00',
    '0x0528932defcf29fc20b7f0b55d7ff8a996d018b79eb3e219281c20ec7f086d894a43556af1594947b5407bffd15d949a84539adea50bbf8a85226c399a25b4c600',
    '0xa93e8c928763b995be145e1084268243a13635953bcbdb23f4a546e07c827ed816507302422320ad377fa79526e034acae1f8d09492e7ce3723a32d29fdf4dea01',
  ],
};

export const nullDepositAmountsClusterLockV1X8 = {
  cluster_definition: {
    name: 'null deposit_amounts',
    creator: {
      address: '',
      config_signature: '',
    },
    operators: [
      {
        address: '',
        enr: 'enr:-HW4QAsMPbcGWZlaTYG9NfyzIKnw6wN11MrH9OKeLq_a_mB8akJTkoqY8p_OrlMW3IWpcP2KcfaamQoAAL22gFnxAFaAgmlkgnY0iXNlY3AyNTZrMaECc8v8p8k9isB8n3q_0gs969Ec2H14tHwQ0KmyeskZ1O4',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QN2uvJ-A-HfrFFXk00h6_3woLkkJjduAAs4xpkp1g1pebhTFPEnTrnI0Pt2pdtH3OT5Yl6nFF4vzYW5gGJqs0cWAgmlkgnY0iXNlY3AyNTZrMaECA3fE7ero5CypBt5k_OPhXxjMVaG5U8pkcKNaZnWxhAI',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QKI7VF_B7JXG5w03Mm59hGM-p1odnD8bGiKFEdAXY4nqK2GP_2GQPY3LZxU6XXnuihkZJh8qo2Z2U_bBZVTII0WAgmlkgnY0iXNlY3AyNTZrMaECe9MQDo5o_v7q0eaHXn4OzgcfH4avwWM0u29cGnHDnGg',
        config_signature: '',
        enr_signature: '',
      },
      {
        address: '',
        enr: 'enr:-HW4QDi0E7eFnahIJd94VSbIG2_IuhkSVTAx_VOM6oQkDhA0eZTHZSQ2c00vsa8AeR8LPZjmUwDD7KvNxgebHc7UotqAgmlkgnY0iXNlY3AyNTZrMaECMBVL5rrUkm3sUq5F9t_MIoQWz5MQuo6NTr_5PhbxcjQ',
        config_signature: '',
        enr_signature: '',
      },
    ],
    uuid: '23C75265-554C-83C1-4B82-A0F30159137E',
    version: 'v1.8.0',
    timestamp: '2024-08-06T14:51:06Z',
    num_validators: 2,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x00000000',
    deposit_amounts: null,
    config_hash:
      '0x2147b404cc1bbfb269e6d9fb244966221fcce33b15ab85b10652338254e4e81d',
    definition_hash:
      '0xcb20df41459fba6adf25f49e94bcf06a7cce14289e186db256114ad8328137a8',
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0x81bfe823b95a9f8799de07f6ae6accf1d7dc8f454be5e049f4e46d4dbd557269d3139ea7ede545c71517d099dc5da90a',
      public_shares: [
        '0xa52a4241e37b4e830f93bd740177d08c3308de5b7711d77641d278665c5c18961e02cb18ec394634d043b815a6a7cf31',
        '0x8f1f017045e63451a3e421f3e5d1219f9e0dbee1ca312f31282ed09a67bbe2dd554d6fcb94c3d1ea37228a147ac14255',
        '0x84f25caa20ac1ff695b9696b27042daec76b32c90bededc09908aed7b03198326ea63b3c7b6767395947ac76074bb688',
        '0xb1718a37d0db33d5e935b1ee950fbf5ad88fe5fb558aa1cd252391f48cf69feaf2beccef1e6b7cbb5265729cb45cbf5b',
      ],
      builder_registration: {
        message: {
          fee_recipient: '0x86b8145c98e5bd25ba722645b15ed65f024a87ec',
          gas_limit: 30000000,
          timestamp: 1606824023,
          pubkey:
            '0x81bfe823b95a9f8799de07f6ae6accf1d7dc8f454be5e049f4e46d4dbd557269d3139ea7ede545c71517d099dc5da90a',
        },
        signature:
          '0xb021590540f9c0a7ab1f7030a510f11dcfe701d7fca8d0811eedc898951457d28f269f6a0fecfc186136ba1522f2e93b18043313c5b76936d1ae923d736500c7283a9dafd3a59f4d80026d73aa9a3219453da62ad5721960f66119b0da624e5c',
      },
      partial_deposit_data: [
        {
          pubkey:
            '0x81bfe823b95a9f8799de07f6ae6accf1d7dc8f454be5e049f4e46d4dbd557269d3139ea7ede545c71517d099dc5da90a',
          withdrawal_credentials:
            '0x01000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '32000000000',
          signature:
            '0xb9969177a01747d320f3bd77f8010459b3e1e310e1a3b6c75bfbea1cd870fbd26a8a34131b8eadc480a8b6d0255a4501115f953617c10ac5032a12ed5002540b91e535b1b52b18d0a500c3f422039c950d29e61bf411fefc4e9d0aa568a43ca1',
        },
      ],
    },
    {
      distributed_public_key:
        '0xb64918e0ac1d5e306c37d3ee21c9fbca3877397d9448841c779dcfdd6f4b9a949c285f72b19305b08e968b7d09974661',
      public_shares: [
        '0xb01cc7ecd82911092484cbb4cf211c14183f4820e037026afead639028b731ef0d7b62221fbcac0c0a48b12116063a32',
        '0xacb06f314e0c116e5e33bffd2ada93832ca1215ea004c046f3d0cdee1bdc1c05787c074216dd0c99464bc471e179f981',
        '0xa3bbf87357b4ebc6a479aeea73951609b9e4c4b1f28fdd2cf91350207029dc44fc28452792f6053c0f2889d9d4bbe9b0',
        '0x84fc2f454d3fb023abcca1abab037d247923cd506a8ec26ef01755d10053acd2176af7baff805a0c7c2442d2ff981cf4',
      ],
      builder_registration: {
        message: {
          fee_recipient: '0x86b8145c98e5bd25ba722645b15ed65f024a87ec',
          gas_limit: 30000000,
          timestamp: 1606824023,
          pubkey:
            '0xb64918e0ac1d5e306c37d3ee21c9fbca3877397d9448841c779dcfdd6f4b9a949c285f72b19305b08e968b7d09974661',
        },
        signature:
          '0xb91c5bc699018d1c0a9b68dacd60f5c85e9d2d769b4271d4c586cc576f0598e48257eafaa0db474b2d1f11fff7ed31d900d4052ae10675fc9713565c8131491588f522da114ea4f506712521683166cd729ddae1d854ca02708d0e15a4cf2155',
      },
      partial_deposit_data: [
        {
          pubkey:
            '0xb64918e0ac1d5e306c37d3ee21c9fbca3877397d9448841c779dcfdd6f4b9a949c285f72b19305b08e968b7d09974661',
          withdrawal_credentials:
            '0x01000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '32000000000',
          signature:
            '0xaaea8e3debc299b927e3930f4305dbe7a89a9ec217d0f262d01d68e64b1afc32d5f32d0d8cbfbdaf2edc2fbe97017bc4085ac76f0be189ce12d9cb80821d4b6a3ec29d3d0a78cc14e0a5117974b518860d4c5f8644126a82758dee5b944957a4',
        },
      ],
    },
  ],
  signature_aggregate:
    '0xb0b2c13ec9c4bf39d731ad38710c67a86861945e320a51ec42c0fe1aba53c0afd9eed63d9e0b0bc503c615fe1aefd3d619292ef278463b3ca3c11741df12615e2984eeeb95750fa898c88fefbca7609da0b1dbfb225a03615bddfbf1f2d00a76',
  lock_hash:
    '0xa79a0f71a7e0412faefd88197785cf4edeb36d4c07343e91132fdd38a649926f',
  node_signatures: [
    '0xe1406808f92ffff202cc627f21cf8a05ea6e5dd823fb2ce0c6b27286c09c7cfe4fa267752a3a53a276270d6d709d27cd5df292d2d5a1d442ad268126ff500c0400',
    '0x7538367a0884a26df61d5514327c1791eb4cb34ab270b2c4fedba6f5954f39c445e49307a149b2ea341aaffb6213de498dd02185583b3fe04929756fe3a41c2300',
    '0x971c848e4f1ec79aa954b5d6e2af7d445631f0ae082be87e9ac0332f5d693de72a52850583b52a10fbdb1ee8bdd009bafd7c1c5dbc726c623a2b22beee4e267501',
    '0xdb6332a4ca9c41592511e7480c835b449fea120430e759735f3c24f1a6d496551a516151d2baae21d0cc9469b28dc1122b672af40ebb0e77045da92e0da6a03500',
  ],
};

// Mainnet Safe cluster - fourth operator (0x4d6c432b7E2F326B4DDf524ea9E56649e5A7C298) is the Safe wallet
export const clusterLockWithSafe = {
  cluster_definition: {
    name: 'Mainnet Safe',
    creator: {
      address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      config_signature:
        '0xefd21c2312d04828e3f625222396b90cadd733a32815a66737927a3c200e859352a39cc509968a1539a5d0a3ba76e63c31e158097b7648c8ad176628057ec1971c',
    },
    operators: [
      {
        address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        enr: 'enr:-HW4QCRE5Y94gDlShBxoe2ZKisye-mkp27v5GJWy-fvd5NszMeqL1hdKC-Wx3NDDLDrw8CBDCSvH-fTDIu7ieAUYpJWAgmlkgnY0iXNlY3AyNTZrMaECTsPdOmEF16TF-1rwcsB2NtyeRhB9PPnpQYI1MFXnsac',
        config_signature:
          '0x60dad0b0ebcb5894a258a937243e4d2d87eb19df5dc5df2ffdd48c1719834ee853a59e282d527574de9865f1e886c6089877bc1bbb2f8ac851c9fa91d972e72d1b',
        enr_signature:
          '0x633d69b9b916bdae52c9020b43ae816f036a1719917f00aee2cea113c2eb257a20950051a853f88179a5133d46d94451238e4915f20505b9b39af2bd464d0f4a1b',
      },
      {
        address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
        enr: 'enr:-HW4QKJwklKw4sbM7RF6A6oyvN4f3XlmKC3gyg1Zgl6DQuHEO2mzBUn3sGWRZbNlQdNsffiiFYvaETqWNbJlzw9Fc0iAgmlkgnY0iXNlY3AyNTZrMaEDQpyNGeWosddyTPURramdKbJOrIcmEeXnN4eo6co5SzE',
        config_signature:
          '0x6d26ffac0175e73ba6942b4a76825f601cfd09317f402b3f4020a29bda69a988445e20e4c1d4e82a636a4c9304fe84a8323561175685dc9b1906bb930e9499951b',
        enr_signature:
          '0x10ec47ea8c77b83e40e752caec4c06e72be1824d963ca8fd66af08386c1190c569d39fce6c6b5cfbcd9367553b2269b4a0a47f598f518dbebd53c8b9bc33fddc1c',
      },
      {
        address: '0xd501824fD822dA83d72E1e87c4b7c7392C0F16e2',
        enr: 'enr:-HW4QE9QGxw69GbB8sWv-M6azW-xGhsTGu9_sOaiAwMguuk4Kfuqe7k7pFkgZEWThi8MNOGVfh0eu5cxGfXw63V_1mSAgmlkgnY0iXNlY3AyNTZrMaEDD2ELq-_Mf85Yt5TDmyGD-ls88XIcBMjpVlWkWdxERqU',
        config_signature:
          '0xfe0e5d214eff25868910cd74da79cddc8511ce2527cfe8fddbd7ec05a928715260b0d3c5415dd1a42c41a879ccde0b6a9e9238c1cb3bbc4e22409fab6a95413c1b',
        enr_signature:
          '0x06f7de645045021b7483f99df2983c2f13e7e062870313f485360f97ac0db33328b919f71b2bc09b87c4eee276cf7ccc0e1a3cb5c1bd59862e3387e884001e2e1b',
      },
      {
        address: '0x4d6c432b7E2F326B4DDf524ea9E56649e5A7C298', // Safe wallet
        enr: 'enr:-HW4QO4tGBoddAcJjpZQokjjoU4sNe465EGs7UhFdv8gle1FNBcqoXl4lQZaBbl7dby8XvO8uVvQ0qCU5CvGCEBd53OAgmlkgnY0iXNlY3AyNTZrMaEDzrup9I6JmJbwwFqH3cTxIvhhPxMO6XbfoHmwJr6k1W8',
        config_signature:
          '0xaf38ffcf5c8e90bbbae0aca2957196701b60ce321ddd702019e0f5805223b82c25f73fc11599aa7621ff364cf7ced6678cf83c16cf22518e9c990a6dcca4c35f1c',
        enr_signature:
          '0x862e8d1d3980c2235ef5be2383551ebb3cb9ae8eb05035914fbb361bbbbeb91813bcc739af160f1a2e9579482ff876d1f0e62fae8c986596e0da3398b167e2511b',
      },
    ],
    uuid: 'd653dff4-fd60-4bfc-b9f8-c739d2de0ac7',
    version: 'v1.10.0',
    timestamp: '2026-03-12T15:12:46.803Z',
    num_validators: 2,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x00000000',
    deposit_amounts: null,
    consensus_protocol: '',
    target_gas_limit: 36000000,
    compounding: true,
    config_hash:
      '0xb8e999fc53176cdd292080802df23447ad34088446558bd3b1e50d7d92eab35a',
    definition_hash:
      '0x9ec6c5e3203eca6a0ef96492f3f526750c8f1a369816f6abf108d2b54178660f',
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
      public_shares: [
        '0x93207f028c76b256b96845ee7159f73707be49270738dc5730fa7aff9ffdd2db32ddbadc72e8ae9d165e9888939adfe9',
        '0xa21447fdd186e0e88fe274e829419364ec5c3b62c1e49d0acc7fa6ff725182fee41d772725e8adcc29625b22fb06a406',
        '0x8582f33fa8b545fc1f8c9fb0d94f20b39cabc2e53065ee4da0967735b7a75e0ea23371df3c1cd6f81b735060993b62b2',
        '0xb6d27b7ec2cbf74a3b23d55319136f1b417fa0361b66f440e0167e593efb618eccba38b80d90f071f346b1ab5e7b3407',
      ],
      builder_registration: {
        message: {
          fee_recipient: '0x86b8145c98e5bd25ba722645b15ed65f024a87ec',
          gas_limit: 36000000,
          timestamp: 1606824023,
          pubkey:
            '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
        },
        signature:
          '0x8fdb84f1f91c08ba887e5b9fe133a4b3fe6cfbde3180c3f346a2164ec1cbbc2ba784c5301f34e308c7288347ecdb4a2917ad349a0d38f3b94a1852425938ec95d5653e2bb01cae63d7a7e36af66e278075c3d6da8b5662f0b550b04be61d65d6',
      },
      partial_deposit_data: [
        {
          pubkey:
            '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '1000000000',
          signature:
            '0xa099405ea1a16e0c0d4c52973d2ec67a749fb432a74bfbf7e742bb37e26503d14c109c1eaab191d5bfc3330d2f08bdc00033c3100fc2b3e2b0d1d9b95d1081610a64f41b6958cd674236ecc753f245519bb2b3a882ca0a064cba1b42bd461739',
        },
        {
          pubkey:
            '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '8000000000',
          signature:
            '0x9968acf3b3dbef9ea33caf5863623c0c7cc8c98a5d14865e0c9dce63cb106b2020adc37bd751e70fba9000b340ea89b201033c3cfc9ee769c397373ab95288d1f9f6254afcb7c95ff39e2eaf9517bb568987a414a4f5e654591aad4927d0b38e',
        },
        {
          pubkey:
            '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '32000000000',
          signature:
            '0xad6545c2dc4c685dec126b346395a2591d102941bd353baf73511c7db3d799ea13ba4dc6ac30540c245b1166cc186bd60f61a2ccceb2fe3107e52b0f725166e6a5d8801fb143af32cfaead6b844cb6ffe71d807a16c18f00fd3bcea9fcb66ee3',
        },
        {
          pubkey:
            '0x84455a235914518c8c2b16718bd8476fc96725ce0057baf2ba4bd57ce8749073f8b207e219f8204623c66c4bdb943591',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '256000000000',
          signature:
            '0x8675c08d8c140766de03de7f704f415f54c97c5b55bf97a2bcb403c33003233ba8dcbaa5aec44d0884bf90f7dc0ceb72004b9e484cade15612b093c0a95fb6da35fdc54678b5f785ee2fdf69fc8e33c9c512a62e1b1dbf34986072983f884111',
        },
      ],
    },
    {
      distributed_public_key:
        '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
      public_shares: [
        '0x91c8c2b02aa1176a00b7f29a2f4e500be8cd766dff7bf976007b5918b3819725b96818b6a284331a8d649e3d8ccc158b',
        '0x981c071fb49a8e99b3bc73149b894dc8d053ae96ac45bd913c0a52c8782063f593ba6eab24a00f4ffb30122ba17bc3f3',
        '0x845f856a865ceed3d409c181dd70d2a5eb519eab10e2685cb8c87776b87ad81c51e63a56f3dbe4fc24b8b47cc1d46225',
        '0xb341d67fac0c4e9761d13fae297ff4ee8c79bc1cf9d9fbe827ed22308f28c595467e3cdb035630d486b000f7a2d016b2',
      ],
      builder_registration: {
        message: {
          fee_recipient: '0x86b8145c98e5bd25ba722645b15ed65f024a87ec',
          gas_limit: 36000000,
          timestamp: 1606824023,
          pubkey:
            '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
        },
        signature:
          '0xaa0a40ee7e8ff66c5b0127d601fa3167d0af8038064dce985b18e0724918c08dccc872111b87e8f9cfaf6ddcaea0a69202823e8299ba90c134cf67fc410e9470200a683d77843c471d25cb263acb85aedcc36c4ed6041f66459a91aaa6d8d8c8',
      },
      partial_deposit_data: [
        {
          pubkey:
            '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '1000000000',
          signature:
            '0xa376cad5d7a52be801524b8215aa1c1606ed67c91f1867149e84255c7d8a09a4162bd7c77893de36eacc0bc0bf1c461303f4971b00b1f8ca0ee3d37d913f5363e79975c7a0d0d6f31a7e4bc6dafe53e6549e6006d6e378d21f27e3ca298ac634',
        },
        {
          pubkey:
            '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '8000000000',
          signature:
            '0xb5c0d0934ac829f427d7afdc237d35fe296574baa7ab499f4dae4f3290012565b246d0baa303f8b843226a3f887497f80f2f50ff2a9e9c93fa13f76e7b36be930d4df17fcebdc323db422a360805b160687c841cf13572ca2dc1f5247bc953c5',
        },
        {
          pubkey:
            '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '32000000000',
          signature:
            '0x876823015c445b40c9c8a787235cd5f8f7b97967e8548b9d8df013409c1748fa247d4a298b7a06b28e54eeabb367dad306b6f34588321467da1dc6619f720c4de2777999d68d8bfec0666a07e31f36b6320297658eae08287691dcc87d62ced5',
        },
        {
          pubkey:
            '0x92360c8ab886fb5188e58091932b08a8dbc17c1fd3510c0e52816478d4ede55d352bdf6f5e165ee2382d7d73ab6b330b',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '256000000000',
          signature:
            '0x957e30cb82c704d4c232dd5793b8b3e8747137344412d2f9b25a3584e796089b2c5af04327c45512febafe9a44cc42c6166644e37f93443b7e6d4c3c4a621003db32ef48142c267b1de161e34b0fdbfc2e4d9e8ccde4362e6583bea987877648',
        },
      ],
    },
  ],
  signature_aggregate:
    '0x81c3637eed59db687012f907a8fe5b99f072cabd86ef54af2f213eb42b485ee522aa6f6948e14bf72607ac1fdc3d71440431e7e38cd22cf74f3b56e5caa2e99b4fe2c7eda993c74b59be0d419b62e31e3ea823949164d6c627a7fd7080dc19bf',
  lock_hash:
    '0xabff2cc9e569c815a27807bfe460e5a46e49df654ff04edde06efa338a011c74',
  node_signatures: [
    '0x8c1e817ba722282f8f665cbb2de510deb10c3631eb2ef50804f6352b238063d4723886137487da882f786aca89e7bc5c87e72dbbb083379bd038b7ed0702a4f601',
    '0xd46f49d087e15691b6d385a635b6cdea639574af5c69afcd4605181258d8a28e3952339f4ab6ed0b21455af604ef34816bb04a4f89ca468f9c7b37703b9e173100',
    '0x2d1b343db432668f7c6c56cb45ee12c5d93827e80d3b5740e650420407b01e5305e7ece3d3ee762b1e01874237c0af0084f60b2c080887b18a12a8e431b96e7600',
    '0x676874526ce3b039632803a3f1e0a25996ccf0d0255f625f7bafd0c6bdaaa57e04e65a9b854a7991849ae0e65226108d8abaa44b5c66874595582ad6deb821a500',
  ],
};

export const clusterConfigV1X10 = {
  name: 'testSDK',
  operators: [
    { address: '0xC35CfCd67b9C27345a54EDEcC1033F2284148c81' },
    { address: '0x33807D6F1DCe44b9C599fFE03640762A6F08C496' },
    { address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f' },
    { address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966' },
  ],
  validators: [
    {
      fee_recipient_address: '0x3CD4958e76C317abcEA19faDd076348808424F99',
      withdrawal_address: '0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e',
    },
  ],
  deposit_amounts: ['8000000000', '32000000000', '8000000000'],
  compounding: true,
  target_gas_limit: 36000000,
  consensus_protocol: '',
};

export const soloClusterConfigV1X10 = {
  name: 'testSDK',
  operators: [
    { address: '' },
    { address: '' },
    { address: '' },
    { address: '' },
  ],
  validators: [
    {
      fee_recipient_address: '0x3CD4958e76C317abcEA19faDd076348808424F99',
      withdrawal_address: '0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e',
    },
  ],
};

// Hoodi group cluster lock v1.10.0 (from obol-api test data)
export const clusterLockV1X10 = {
  cluster_definition: {
    name: 'test group flow v1.10.0',
    creator: {
      address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      config_signature:
        '0xf5643d524e580b34677ea1e535c8a4555f8d71a4ff5eefda67c55342f9a5af2621abd021b5eedc70f8cd8b1f09e295e8fe58774260bce5da08348455e44692f21c',
    },
    operators: [
      {
        address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        enr: 'enr:-HW4QLlrtMjFLGkFT1bwdGbvZQlH8hLi0M2g44JAxEYP3BZmYpcsy9Q56HPPD87fMucjvLv4-obEFacpsg0ehRilbHeAgmlkgnY0iXNlY3AyNTZrMaEDRaa5o2aSgqyFq_ERZcQTztrOij1mFtXX1bJuVI6ieak',
        config_signature:
          '0x0d755fdae37bc9041e5aa5dc155b6b2c88b5678e91802e581d023ceab7d7fab03283a0f4b7d5b57561ad0f5c3e31e0639ea8d2d1c06251f034d1b5885f33c6e41c',
        enr_signature:
          '0xfb25dc2d711f89e4b11609b4828ef1b413adcdb2526120e128c8a6503a22ab5e348f24afe1e38b486e5b4b89bab8b9e9252edfe1e0495ff8b8a1d084b558068e1c',
      },
      {
        address: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
        enr: 'enr:-Iu4QNbiUUUwT18LynBbVPJhNxvzQsaSpUr40mQTWscnZaqKb6vAlvV8j-eDDR3E0wjMQumGRbGm2IAb5_k4bVWJiVGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPOiodUji0ohgJb5sNK1hgv8g6xO5_znZz3NkkBkyYyKIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x5bef9278ad32cc198fd7e1872ed329a77426d50ccd4e43fff72e97059296e0277e39a92b5cb22eb7d9aa67ca030a9c582351bff6adc600028dc65af5b9e889ee1c',
        enr_signature:
          '0x23f289572c847105245e573c1cae2f833fd23ab68e97a4973b7a4f4139fa28333b83c27967b58474454cc66e29922c128e0a90c777d47c69d76ab77aa1675e661b',
      },
      {
        address: '0xd501824fD822dA83d72E1e87c4b7c7392C0F16e2',
        enr: 'enr:-Iu4QJyserRukhG0Vgi2csu7GjpHYUGufNEbZ8Q7ZBrcZUb0KqpL5QzHonkh1xxHlxatTxrIcX_IS5J3SEWR_sa0ptGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQMAUgEqczOjevyculnUIofhCj0DkgJudErM7qCYIvIkzIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x466f7b80ce157cd89f81a7bce4e5df4c57200d1468c54f4c027aefdf574ca6ec7870f3b04e685fda0fe596328fcae4be5ba25418feb9390fb77319d349c559321c',
        enr_signature:
          '0xd27715d2efe15807aea032c2d4d64866ee36943dc96797a8b25512b9017bac3258bdb6a1c143a2cfb1ea53ffced12f543bc4d375ed0e814fac0289cadebc7e751c',
      },
      {
        address: '0x5FCF1C339D3E54B977720bA376d65Be2671f9e15',
        enr: 'enr:-HW4QKJTwXC6Chw6zbnA3HFZi6Jo0DkIgjKy4eUBpsSOGnAeWE6ChEjEyk_6R6Qrm7jI-iqfs3_HYxiKde8vFgvHHrCAgmlkgnY0iXNlY3AyNTZrMaECfFKQH4spdZCHqrKVz1Q02xYla6J_RQECDNNYBRWdzv8',
        config_signature:
          '0xd245fcf3d444f915d60c4bd1a133e800b80017bed9b7dfeb178b427c47dbdbca2bf21ead645baf4df400fe44adcf09add9b186a711073757930b61d577d544e91b',
        enr_signature:
          '0x34772ea717edcad8cd3c7ccce461e2426f8ab9c9a64081e399acef2fb3cdd5bb1fad68d4f3a403de12c04334fd12ca7cd5bedf0fdd6accad3f31359c2e5c687d1b',
      },
    ],
    uuid: '6da0c05b-143a-4081-9f67-a7bc8b4c484c',
    version: 'v1.10.0',
    timestamp: '2025-04-10T08:51:45.596Z',
    num_validators: 1,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
        withdrawal_address: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x10000910',
    deposit_amounts: ['32000000000'],
    config_hash:
      '0x6d2c319783904c932a9a9493cce908d5b0fe6ff76ee72dcac691743b6cfaeb30',
    definition_hash:
      '0x7783a40fe582bc1f4122cee0dea0af44d6d54c75065c39ceb56baef40878713f',
    consensus_protocol: 'qbft',
    target_gas_limit: 30000000,
    compounding: true,
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5',
      public_shares: [
        '0xb6b24044bb78eae5801a41bb98ebda85d3210d08706e7a10ef42bebbf4505cd343d396ed10cdb1f63aa1ca9a850d97d7',
        '0x8c15903d870956aede8118806ab5bc36ed18bb3db7fc8fa86893e040c04f6322b9488e844882e0bc98df94dabb781e6a',
        '0x8d582fcac937895ca521a7f83cd43274656ea9b382eb5db2e096c3332c6488b56e5889456cabc5f56e0287d408146689',
        '0xa88805bb74b0a651a563c595fb6da9a561311894251db6dbf4ea21d2a5478becf8597dc1bb6bcb0c7129194540216b85',
      ],
      partial_deposit_data: [
        {
          pubkey:
            '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5',
          withdrawal_credentials:
            '0x02000000000000000000000086b8145c98e5bd25ba722645b15ed65f024a87ec',
          amount: '32000000000',
          signature:
            '0x9270ce08995b529d1bf452fe119c8b35a16bb6965caaaa02026e4be68b2bdf36040c4e85e9f1bd15d3daac67114fdfed0925e389f8250b67bf25d38462abcd4322db08c2d85283c9de41979e061e67e1c9920e24e33dd290763051375380d4fd',
          deposit_data_root:
            '939ee02a3799ae961c29c62ffbdd29ad2d1639d27f445ee877984e20a6c4538a',
        },
      ],
      builder_registration: {
        message: {
          fee_recipient: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
          gas_limit: 30000000,
          timestamp: 1742213400,
          pubkey:
            '0xa47fefdb2d5c92bfd319463b83975744c29ba8a646b5c0306e5591c6646a49834c787c1ad6f6d9b031015e230bd0d1f5',
        },
        signature:
          '0x922acbf83ac4e08f92b3ade62edb157112f843d0d37951931c58db79050930096aadf4371914cd6b95a0c7898c3b0e5107609ab20e563de012abfc9bd8159a26b9be7c5b7caa9606f89bc84f1ac983867196b1582f483e171a08c7633d1cc6ea',
      },
    },
  ],
  signature_aggregate:
    '0xa310ec499e2e28af04e53c3dd0df451b079d31a7da21782da8ecd0d3d401a9e2874c90ba349ea94369be5fe3368d6f4815df06f3d519b553f3035162a492ccfcf7959cd9a70f2c1d683af6d4aa1348f7a99ba3a31cc35e94946bf5c431bf8f20',
  lock_hash:
    '0xfa580e215c8e03f558e6d405d2711de8fcb3117f3a0022677fae61d63e9eef0c',
  node_signatures: [
    '0xb46273b555045c277837a1c408d66ecd152cbf5a015eca90aa49c4a4d6c68e3b6770957dfb207fa95125e53d10e9276dfaa5caf656827e4b759195b1378bd09700',
    '0x5038d86c5b22971516ab25ca46664626b7f97c924c93c483be5224681bcd965b0b84866f7a21769183cb943145276fc972dc8a6fba5a9565eaba0d2c02cae84901',
    '0xbefc458f13aeb9bf38da866d93fa8cd703ac839d0506e65cd9550b24bf296691227de91fbe03e5e19af7e07226ee6af4ad86855935db87c04a0cc14267fb9f6c01',
    '0x2885bdbc5b0524300de1e585dceee81e3252997ef4703b37c16bd5662679354254ab45a17d53ab4ea7abfeaade5f9fa6008394fb8bd7a8dfd259436275f73afe00',
  ],
};

// Hoodi group cluster lock with compounding (same as clusterLockV1X10 - group cluster has compounding: true)
export const clusterLockWithCompoundingWithdrawals = clusterLockV1X10;

// Hoodi v1.10.0 compounding (typo in name - kept for backward compat)
export const clusterLockWithCompoundingWithdrawalss = {
  cluster_definition: {
    name: 'test v1.10.0',
    creator: {
      address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
      config_signature:
        '0x62b609c3a56439fe60785895d60a36912b85d50c14a41fce36795c65d6263bb207467a4d4be7dc292bfd1c636332b1c409feaec6ce2ae9488ae1ad622264a7a81c',
    },
    operators: [
      {
        address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
        enr: 'enr:-HW4QLlrtMjFLGkFT1bwdGbvZQlH8hLi0M2g44JAxEYP3BZmYpcsy9Q56HPPD87fMucjvLv4-obEFacpsg0ehRilbHeAgmlkgnY0iXNlY3AyNTZrMaEDRaa5o2aSgqyFq_ERZcQTztrOij1mFtXX1bJuVI6ieak',
        config_signature:
          '0x58c31787cf1f9680f736713f4ce039c8bf69467e5128edb2888d380451bd757367665c1ba04dc7656eb0b77eac39f776780710e603372f2a41bd40f4d297c7fa1c',
        enr_signature:
          '0x4df48b8fc16deb2441022a019b72976524f4ce3dd674ee70561fb9eb52985d3b0d9528532d3e5be7a44548be27e9e96c5358b9f6756c7c7a97e2126f9c2c9b071b',
      },
      {
        address: '0xa084D9095BcBdFe8014B68fa52D73DCeb16C5129',
        enr: 'enr:-Iu4QNbiUUUwT18LynBbVPJhNxvzQsaSpUr40mQTWscnZaqKb6vAlvV8j-eDDR3E0wjMQumGRbGm2IAb5_k4bVWJiVGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPOiodUji0ohgJb5sNK1hgv8g6xO5_znZz3NkkBkyYyKIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0xc76b2f067a65c9cc6110ab99471b03f47545581e79164758114c98825d5440891843790ce92ca24ee7b3568b839cc88c2b3824587f8f260fca15bb852f69a3af1c',
        enr_signature:
          '0x49e2a07424e412ed904fd47381c36203cb8c5575a31ba260b3f8420dc89a86fc0d7fbc087160a60690be2f6fb212423d467e212494992ab9a72f10319779a2cc1c',
      },
      {
        address: '0xb1D2740Ee055693FE21bbCfc780729472C3f6B84',
        enr: 'enr:-Iu4QJyserRukhG0Vgi2csu7GjpHYUGufNEbZ8Q7ZBrcZUb0KqpL5QzHonkh1xxHlxatTxrIcX_IS5J3SEWR_sa0ptGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQMAUgEqczOjevyculnUIofhCj0DkgJudErM7qCYIvIkzIN0Y3CCDhqDdWRwgg4u',
        config_signature:
          '0x8b0cea21e065d25faa3b9d3b9e8f497d3c2d8baf800a1c5ecbde64c041745b7e15131d28f7ab917bdcead3225dda16987f2fd160546e087987cbb483bd187cb11b',
        enr_signature:
          '0x805f38269379087168900a37569f1108b9d4253a03c2650a4e8d69228cb4cc616b94988e4b218a8d47113063270c4a894e873a5070c7ef0f4d44ee3359eec51b1b',
      },
      {
        address: '0x69D39e2d0Fb6fb80CCd5d49a75416cB7d1BC6DB6',
        enr: 'enr:-HW4QKJTwXC6Chw6zbnA3HFZi6Jo0DkIgjKy4eUBpsSOGnAeWE6ChEjEyk_6R6Qrm7jI-iqfs3_HYxiKde8vFgvHHrCAgmlkgnY0iXNlY3AyNTZrMaECfFKQH4spdZCHqrKVz1Q02xYla6J_RQECDNNYBRWdzv8',
        config_signature:
          '0x9e21c2308738fb17b38d1850b83312c25306c0bcbd575e0417e311d5fc1697807291328a299859df70ac3efb402207067dbb0559bc4fef4e6ca2fd77fa4c2a321c',
        enr_signature:
          '0x3a6590600b2dc27b042aabd3fa4654f1064b42e8f850d1fac13394a6786463be2a2727623e4e9e98453113f7024e73d652d1c6288ef82ede7acbb08e25ff00751b',
      },
    ],
    uuid: '34036642-9d45-4b6f-817d-f8d5aa0110d4',
    version: 'v1.10.0',
    timestamp: '2025-04-03T17:27:27.767Z',
    num_validators: 1,
    threshold: 3,
    validators: [
      {
        fee_recipient_address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
        withdrawal_address: '0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f',
      },
    ],
    dkg_algorithm: 'default',
    fork_version: '0x10000910',
    deposit_amounts: ['32000000000'],
    consensus_protocol: 'abft',
    target_gas_limit: 30000000,
    compounding: true,
    config_hash:
      '0xe6d2e8fe49d722f55ced8a028c62ffbde16a05bc74d7d9703b675ecc8c820b4b',
    definition_hash:
      '0xb5d81494f98df23cdff33909888080054f1068c11bbee5ec39aeb95edfa3b37c',
  },
  distributed_validators: [
    {
      distributed_public_key:
        '0x8368525a657df38fd3d774a08f1a54f008ae3340e8441a2bbb2d2051a9a8f46d4eeb8610bbc088e7402cba6b138c7b70',
      public_shares: [
        '0xae455c727456238fadd7b84ded0f0fb700d0e2fa028fff34e3fc73d0279ee9a5aa9843f8af00c9518ea781d8d823cc0d',
        '0x91a7cfa9682464dff7324c0907fdff41df3f2643fd97d30559d82fbbfa354dae1e3f9176d8562b5ab47d3460240004cb',
        '0xac8c0ffdb9ea7ce63bbed67122123c86ffa669a5027da5f96ab85b68c3a491253ebf0308cf4e237ea4eaf8543064c8a8',
        '0x85385ef7cf1b1d9cd648ceb45e92516ef9612c9830b0abf808ea7996ad9369764bb9ac27c3cd730497e12e394ab48d16',
      ],
      builder_registration: {
        message: {
          fee_recipient: '0xc6e76f72ea672fae05c357157cfc37720f0af26f',
          gas_limit: 30000000,
          timestamp: 1742213400,
          pubkey:
            '0x8368525a657df38fd3d774a08f1a54f008ae3340e8441a2bbb2d2051a9a8f46d4eeb8610bbc088e7402cba6b138c7b70',
        },
        signature:
          '0xb73c4d55c17bdbbb53790fee3294ef2c69b2a6e4c700eb30603e437308005edacbe76591f917aa82cfcf60da2d669ccd101ae9b3dc4b1ae61ab7ad1794620adbdc0b4ea5f91fc5e790833537c610a57ccdc4c95ca53cb6dedec2be2ad8acf266',
      },
      partial_deposit_data: [
        {
          pubkey:
            '0x8368525a657df38fd3d774a08f1a54f008ae3340e8441a2bbb2d2051a9a8f46d4eeb8610bbc088e7402cba6b138c7b70',
          withdrawal_credentials:
            '0x020000000000000000000000c6e76f72ea672fae05c357157cfc37720f0af26f',
          amount: '32000000000',
          signature:
            '0xa7c5c2417f5afd089b87df0eff10855b748d621749879b6087c8a1dbfcbb95aa79a2c8f4d637ecb283426b9c5af07c30080c19a245ea614ff3f609a92994e9a29f3c0f8c4bf1a4e7ef58615ff80586b40e36859c9fd935b68ae55670e29ea5d7',
        },
      ],
    },
  ],
  signature_aggregate:
    '0x8b9f884ab3ab89d63f49437cae09e2b77757787f2c54bb52bc51df1d565bc6d63ef9fc4e0ea76bd72a58618651b827a611d8e96de238fad4616420b4cd393ad62428ac9db2e01a4e8dd8ae835845e7530f9e1b3b4ebf5ba2da3c77aec70d06b2',
  lock_hash:
    '0xaf6b0d989fdd82f7f9683d62b9f797af129f9afae2a4b453a0bef1814b21ae5d',
  node_signatures: [
    '0xc059b3920fc107a909feb16217c7372911c5cb386954ed899b5d8e782d6d71e17a5dde1c2d4825b7c2b5edd63b4eb9c306afd4afd5dbce3f8db9c13d06d6cebf01',
    '0x051a72e5f2a66a85aabd635a210350f82924350170981575f3cb67e7699791d7118ab7c284f10b52f3604a89aa0bc43ad2d2537a7b19b109610324926475d30900',
    '0xa28a23de3703c3eeb9a091d4f47302a96079759baf1afca428cbd298b46c40fe103df0006dfd5a0ffd15ee7c5fa436d70d7a03d4537dd8292a6152734e5f689601',
    '0x992ab5c73d30d10cc5c8f6d462ba387fd5a698e206b0dfdd0224d17117f85a2077fcaa62fd6d5170ff678249288fcd82877e2987ed5564df5dbd9d51370871c800',
  ],
};
