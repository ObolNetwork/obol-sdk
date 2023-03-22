"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var splits_sdk_1 = require("@0xsplits/splits-sdk");
// const definitions = require('./cluster-definitions.json')
// const definitions = require('./mock.json')
var definitions = require('./cluster-definitions5.json');
var fs = require('fs');
function isSplitMetadataExists(_a) {
    var _b = _a.chainId, chainId = _b === void 0 ? 5 : _b, _c = _a.splitId, splitId = _c === void 0 ? '0xd822FFC91AA029Aa5a4C15a4a87796A7f968C6aC' : _c;
    var splitsClient = new splits_sdk_1.SplitsClient({
        chainId: chainId
    });
    return splitsClient.getSplitMetadata({ splitId: splitId }).then(function (res) { return res; })["catch"](function () { return null; });
}
console.log("Program start");
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
var defs = definitions;
var suspects = 0;
var unlikely = 0;
defs.forEach(function (def) {
    //
    console.log(def.fee_recipient_address);
});
// const splits = defs.map(def => {
//     return isSplitMetadataExists({ splitId: def.fee_recipient_address })
// })
// Promise.all(splits).then(res => {
//     console.log('All splitters resolved:')
//     console.log(res)
// })
// Att 2
var newdefs = defs.map(function (def) { return __awaiter(void 0, void 0, void 0, function () {
    var split;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, isSplitMetadataExists({
                    splitId: def.fee_recipient_address
                })];
            case 1:
                split = _a.sent();
                return [2 /*return*/, __assign(__assign({}, def), { split_details: split })];
        }
    });
}); });
Promise.all(newdefs).then(function (res) {
    console.log(res);
    fs.writeFile('output-5.json', JSON.stringify(res), 'utf8', function (err) {
        if (err) {
            console.log('An error occured while writing JSON Object to File.');
            return console.log(err);
        }
        console.log('JSON file has been saved.');
    });
});
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
