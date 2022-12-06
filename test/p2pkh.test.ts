import { expect } from 'chai'
import { loadDescription } from './helper'
import { buildContractClass } from '../src/contract'
import { bsv, num2bin, Ripemd160, SigHashPreimage, toHex, Sig, PubKey } from '../src'

describe('test.P2PKH', () => {

    const privateKey = bsv.PrivateKey.fromRandom('testnet');
    const publicKey = bsv.PublicKey.fromPrivateKey(privateKey);
    const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(publicKey.toBuffer());

    it('should unlock success', () => {

        const DemoP2PKH = buildContractClass(loadDescription('p2pkh_desc.json'))
        let p2pkh = new DemoP2PKH(new Ripemd160(toHex(publicKeyHash)))

        const inputIndex = 0;

        let callTx = new bsv.Transaction()
            .addDummyInput(p2pkh.lockingScript, 1000)
            .change(bsv.Transaction.DUMMY_PRIVATEKEY.toAddress())
            .setInputScript({
                inputIndex,
                privateKey
            }, (tx) => {
                return p2pkh.unlock(new Sig(tx.getSignature(0)), new PubKey(toHex(publicKey))).toScript();
            })
            .seal();


        // verify all tx inputs
        expect(callTx.verify()).to.be.true

        // just verify the contract inputs
        expect(callTx.verifyInputScript(0).success).to.true

    })


})
