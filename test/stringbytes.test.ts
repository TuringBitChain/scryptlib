
import { assert, expect } from 'chai';
import { newTx, loadDescription } from './helper';
import { buildContractClass } from '../src/contract';
import { bsv, getPreimage } from '../src/utils';
import { Bytes, SigHashPreimage } from '../src';
import { stringToBytes } from '../src/scryptTypes';
const inputIndex = 0;
const inputSatoshis = 100000;

const outputAmount = inputSatoshis


describe('String.test', () => {

  describe('test String', () => {

    let instance, result;

    const Test = buildContractClass(loadDescription('stringbytes_desc.json'));
    before(() => {
      instance = new Test();
    });

    it('should succeeding when call unlock', () => {
      result = instance.unlock(Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("こんにちは"),
        stringToBytes("b'aa'"), stringToBytes("😊")).verify()
      expect(result.success, result.error).to.be.true
    });


    it('should succeeding when call testEmpty', () => {
      result = instance.testEmpty(stringToBytes("")).verify()
      expect(result.success, result.error).to.be.true
    });

    it('should fail when using wrong value', () => {
      result = instance.unlock(Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("ここんにちは"),
        stringToBytes("b'aa'"), stringToBytes("😊")).verify()
      expect(result.success, result.error).to.be.false
    });


    it('should throw when using Bytes for utf8', () => {

      expect(() => Bytes("你好world1"))
        .to.throw(`<你好world1> should only contain [0-9] or characters [a-fA-F]`)

    });

  })

  describe('test stringbytes1.scrypt ', () => {

    let instance, result;

    const Test = buildContractClass(loadDescription('stringbytes1_desc.json'));

    before(() => {
      instance = new Test([Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("こんにちは"),
      stringToBytes("b'aa'"), stringToBytes("😊")],
        Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("こんにちは"), stringToBytes("b'aa'"), stringToBytes("😊"));
    });

    it('should succeeding when call unlock', () => {
      result = instance.unlock(Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("こんにちは"),
        stringToBytes("b'aa'"), stringToBytes("😊")).verify()
      expect(result.success, result.error).to.be.true
    });

    it('should succeeding when with empty space', () => {

      instance = new Test([Bytes("1234ab"), stringToBytes("你好  world"), stringToBytes("ab/[]]]cd"), stringToBytes("()rrr)"), stringToBytes("b'aa'"), stringToBytes("😊😊")],
        Bytes("1234ab"), stringToBytes("你好  world"), stringToBytes("ab/[]]]cd"), stringToBytes("()rrr)"), stringToBytes("b'aa'"), stringToBytes("😊😊"));


      result = instance.unlock(Bytes("1234ab"), stringToBytes("你好  world"), stringToBytes("ab/[]]]cd"), stringToBytes("()rrr)"), stringToBytes("b'aa'"), stringToBytes("😊😊")).verify()
      expect(result.success, result.error).to.be.true
    });

    it('should succeeding when with empty bytes', () => {
      instance = new Test([Bytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes("")],
        Bytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""));
      result = instance.unlock(Bytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes(""), stringToBytes("")).verify()
      expect(result.success, result.error).to.be.true
    });

    it('should succeeding when \n, \", \'', () => {

      const str = `aa " " " ' 

aa`;
      instance = new Test([Bytes(""), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str)],
        Bytes(""), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str));
      result = instance.unlock(Bytes(""), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str), stringToBytes(str)).verify()
      expect(result.success, result.error).to.be.true
    });

    it('should fail when using wrong value', () => {
      result = instance.unlock(Bytes("1234ab"), stringToBytes("你好world"), stringToBytes("abcd"), stringToBytes("ここんにちは"),
        stringToBytes("b'aa'"), stringToBytes("😊")).verify()
      expect(result.success, result.error).to.be.false
    });
  })


  describe('test stringbytes1.scrypt ', () => {

    let instance, result;

    const Logger = buildContractClass(loadDescription('stringbytes2_desc.json'));

    before(() => {
      instance = new Logger(stringToBytes("message:"));
    });

    it('should succeeding when call unlock', () => {


      let newLockingScript = instance.getNewStateScript({
        message: stringToBytes("message:this is a logger contract")
      })

      const tx = newTx(inputSatoshis);
      tx.addOutput(new bsv.Transaction.Output({
        script: newLockingScript,
        satoshis: outputAmount
      }))

      const preimage = getPreimage(tx, instance.lockingScript, inputSatoshis, 0, bsv.crypto.Signature.SINGLE)

      instance.txContext = {
        tx: tx,
        inputIndex,
        inputSatoshis
      }

      result = instance.log(SigHashPreimage(preimage), stringToBytes("this is a logger contract")).verify()
      expect(result.success, result.error).to.be.true
    });


  })


  describe('test helloworld', () => {

    let instance, result;

    const HelloWorld = buildContractClass(loadDescription('helloworld_desc.json'));
    before(() => {
      instance = new HelloWorld();
    });

    it('should succeeding when call unlock', () => {
      result = instance.unlock(stringToBytes("hello world, sCrypt 😊"), stringToBytes("\r\n")).verify()
      expect(result.success, result.error).to.be.true
    });
  })
})

