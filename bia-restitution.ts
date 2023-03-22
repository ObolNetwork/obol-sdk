import { SplitsClient } from '@0xsplits/splits-sdk'
// const definitions = require('./cluster-definitions.json')
// const definitions = require('./mock.json')
const definitions = require('./cluster-definitions5.json')
const fs = require('fs')

function isSplitMetadataExists({
  chainId = 5,
  splitId = '0xd822FFC91AA029Aa5a4C15a4a87796A7f968C6aC',
}): Promise<any> {
  const splitsClient = new SplitsClient({
    chainId,
  })

    return  splitsClient.getSplitMetadata({ splitId: splitId }).then(res => {return res}).catch(() => {return null})
    

}
console.log(`Program start`)
// const test = isSplitMetadataExists({})
// test.then(resp =>{
//     console.log(`Running split checker.`)
//     console.log(resp)
// })

// const test2 = isSplitMetadataExists({splitId: "0xdc62f9e8C34be08501Cdef4EBDE0a280f576D762"})
// test2.then(resp =>{
//     console.log(`Failed split:`)
//     console.log(resp)
// }).catch(err =>{
//     console.log(`Guessing its not a split`)
// })

// Import file

let defs: Array<any> = definitions as Array<any>
let suspects = 0
let unlikely = 0
defs.forEach((def) => {
  //
  console.log(def.fee_recipient_address)
})

// const splits = defs.map(def => {
//     return isSplitMetadataExists({ splitId: def.fee_recipient_address })
// })

// Promise.all(splits).then(res => {
//     console.log('All splitters resolved:')
//     console.log(res)
// })

// Att 2

const newdefs = defs.map(async (def) => {
  const split = await isSplitMetadataExists({
    splitId: def.fee_recipient_address,
  })
  return { ...def, split_details: split }
})
Promise.all(newdefs).then((res) => {
  console.log(res)
  fs.writeFile('output-5.json', JSON.stringify(res), 'utf8', function (err: any) {
    if (err) {
      console.log('An error occured while writing JSON Object to File.')
      return console.log(err)
    }

    console.log('JSON file has been saved.')
  })
})

// Att 3

// let newdefs: any[] = [];
// for(let i = 0; i < defs.length; i++){
//     let split = isSplitMetadataExists({
//               splitId: defs[i].fee_recipient_address,
//             }).then(res =>{
//                 // console.log(`Split res`)
//                 // console.log(res)
//                 if(!!res){
//                     newdefs.push({...defs[i], split_info: res})
//                 }
                
//             })

// }

// console.log(newdefs)

// const newdefs = defs.map(async (def) => {
//     const split = await isSplitMetadataExists({
//       splitId: def.fee_recipient_address,
//     })
//     return { ...def, split_details: split }
//   })
//   Promise.all(newdefs).then((res) => {
//     console.log(res)
//     fs.writeFile('output-500.json', JSON.stringify(res), 'utf8', function (err: any) {
//       if (err) {
//         console.log('An error occured while writing JSON Object to File.')
//         return console.log(err)
//       }
  
//       console.log('JSON file has been saved.')
//     })
//   })
  