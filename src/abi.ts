import { int2Asm, bsv, arrayTypeAndSize, genLaunchConfigFile, getStructNameByType, isArrayType, isStructType, checkArray, flatternArray, typeOfArg, flatternStruct, createStruct, createArray, asm2ScryptType } from './utils';
import { AbstractContract, TxContext, VerifyResult, AsmVarValues } from './contract';
import { ScryptType, Bool, Int, SingletonParamType, SupportedParamType, Struct, TypeResolver, PubKey, Sig, Ripemd160, Sha1, Sha256, SigHashType, SigHashPreimage, OpCodeType } from './scryptTypes';
import { ABIEntityType, ABIEntity, ParamEntity } from './compilerWrapper';
import { buildContractCodeASM, readState } from './internal';
import { bin2num, Bytes, VariableType } from '.';

export interface Script {
  toASM(): string;
  toHex(): string;
}

export type FileUri = string;

/**
     * Configuration for a debug session.
     */
export interface DebugConfiguration {
  type: 'scrypt';
  request: 'launch';
  internalConsoleOptions: 'openOnSessionStart',
  name: string;
  program: string;
  constructorArgs: SupportedParamType[];
  pubFunc: string;
  pubFuncArgs: SupportedParamType[];
  asmArgs?: AsmVarValues;
  txContext?: any;
}

export interface DebugLaunch {
  version: '0.2.0';
  configurations: DebugConfiguration[];
}


export interface Argument {
  name: string,
  type: string,
  state: boolean,
  value: SupportedParamType
}

export type Arguments = Argument[];


export class FunctionCall {

  readonly contract: AbstractContract;

  readonly args: Arguments = [];

  private _unlockingScriptAsm?: string;

  private _lockingScriptAsm?: string;

  get unlockingScript(): Script | undefined {
    return this._unlockingScriptAsm === undefined ? undefined : bsv.Script.fromASM(this._unlockingScriptAsm);
  }

  get lockingScript(): Script | undefined {
    return this._lockingScriptAsm === undefined ? undefined : bsv.Script.fromASM(this._lockingScriptAsm);
  }

  init(asmVarValues: AsmVarValues): void {
    for (const key in asmVarValues) {
      const val = asmVarValues[key];
      const re = new RegExp(key.startsWith('$') ? `\\${key}` : `\\$${key}`, 'g');
      this._lockingScriptAsm = this._lockingScriptAsm.replace(re, val);
    }
  }

  constructor(
    public methodName: string,
    binding: {
      contract: AbstractContract;
      lockingScriptASM?: string;
      unlockingScriptASM?: string;
      params: SupportedParamType[];
    }
  ) {

    if (binding.lockingScriptASM === undefined && binding.unlockingScriptASM === undefined) {
      throw new Error('param binding.lockingScriptASM & binding.unlockingScriptASM cannot both be empty');
    }

    this.contract = binding.contract;


    this.args = Object.getPrototypeOf(this.contract).constructor.abi.filter((entity: ABIEntity) => {
      if ('constructor' === methodName) {
        return entity.type === 'constructor';
      }
      return entity.name === methodName;
    }).map((entity: ABIEntity) => {
      return entity.params.map((param, index) => {
        return {
          name: param.name,
          type: param.type,
          state: param.state || false,
          value: binding.params[index]
        };
      });
    }).flat(1);

    if (binding.lockingScriptASM) {
      this._lockingScriptAsm = binding.lockingScriptASM;
    }

    if (binding.unlockingScriptASM) {
      this._unlockingScriptAsm = binding.unlockingScriptASM;
    }
  }

  toASM(): string {
    if (this.lockingScript) {
      return this.lockingScript.toASM();
    } else {
      return this.unlockingScript.toASM();
    }
  }

  toString(): string {
    return this.toHex();
  }

  toScript(): Script {
    return bsv.Script.fromASM(this.toASM());
  }

  toHex(): string {
    return this.toScript().toHex();
  }



  genLaunchConfigFile(txContext?: TxContext): FileUri {

    const Class = this.contract.constructor as typeof AbstractContract;

    const constructorArgs: SupportedParamType[] = this.contract.ctorArgs().map(p => p.value);
    const pubFuncArgs: SupportedParamType[] = this.args.map(arg => arg.value);
    const pubFunc: string = this.methodName;
    const name = `Debug ${Object.getPrototypeOf(this.contract).constructor.contractName}`;
    const program = `${Object.getPrototypeOf(this.contract).constructor.file}`;

    const asmArgs: AsmVarValues = this.contract.asmArgs || {};

    const state: string = !AbstractContract.isStateful(this.contract) && this.contract.dataPart ? this.contract.dataPart.toASM() : undefined;
    const txCtx: TxContext = Object.assign({}, this.contract.txContext || {}, txContext || {}, { opReturn: state });

    return genLaunchConfigFile(constructorArgs, pubFuncArgs, pubFunc, name, program, txCtx, asmArgs);
  }

  verify(txContext?: TxContext): VerifyResult {
    if (this.unlockingScript) {
      const result = this.contract.run_verify(this.unlockingScript.toASM(), txContext, this.args);

      if (!result.success) {
        const debugUrl = this.genLaunchConfigFile(txContext);
        if (debugUrl) {
          result.error = result.error + `\t[Launch Debugger](${debugUrl.replace(/file:/i, 'scryptlaunch:')})\n`;
        }
      }
      return result;
    }

    return {
      success: false,
      error: 'verification failed, missing unlockingScript'
    };
  }

}

export class ABICoder {

  constructor(public abi: ABIEntity[], public finalTypeResolver: TypeResolver) { }


  encodeConstructorCall(contract: AbstractContract, asmTemplate: string, ...args: SupportedParamType[]): FunctionCall {

    const constructorABI = this.abi.filter(entity => entity.type === ABIEntityType.CONSTRUCTOR)[0];
    const cParams = constructorABI?.params || [];

    if (args.length !== cParams.length) {
      throw new Error(`wrong number of arguments for #constructor, expected ${cParams.length} but got ${args.length}`);
    }

    // handle array type
    const cParams_: Array<ParamEntity> = [];
    const args_: SupportedParamType[] = [];
    cParams.map(p => ({
      name: p.name,
      type: this.finalTypeResolver(p.type),
      state: p.state
    })).forEach((param, index) => {

      if (isArrayType(param.type)) {
        const arg = args[index] as SupportedParamType[];
        if (checkArray(arg, param.type)) {
          // flattern array
          flatternArray(arg, param.name, param.type).forEach((e) => {
            cParams_.push({ name: e.name, type: this.finalTypeResolver(e.type), state: param.state });
            args_.push(e.value);
          });
        } else {
          throw new Error(`constructor ${index}-th parameter should be ${param.type}`);
        }

      } else if (isStructType(param.type)) {
        const arg = args[index] as Struct;

        if (param.type != arg.finalType) {
          throw new Error(`expect struct ${getStructNameByType(param.type)} but got struct ${arg.type}`);
        }

        flatternStruct(arg, param.name).forEach(v => {
          cParams_.push({ name: `${v.name}`, type: this.finalTypeResolver(v.type), state: param.state });
          args_.push(v.value);
        });
      }
      else {
        const arg = args[index] as SupportedParamType;
        cParams_.push(param);
        args_.push(arg);
      }
    });



    cParams_.forEach((param, index) => {
      if (!asmTemplate.includes(`$${param.name}`)) {
        throw new Error(`abi constructor params mismatch with args provided: missing ${param.name} in ASM tempalte`);
      }
      if (param.state) {
        //if param is state , we use default value to new contract.
        if (param.type === VariableType.INT || param.type === VariableType.PRIVKEY) {
          contract.asmTemplateArgs.set(`$${param.name}`, 'OP_0');
        } else if (param.type === VariableType.BOOL) {
          contract.asmTemplateArgs.set(`$${param.name}`, 'OP_TRUE');
        } else if (param.type === VariableType.BYTES
          || param.type === VariableType.PUBKEY
          || param.type === VariableType.SIG
          || param.type === VariableType.RIPEMD160
          || param.type === VariableType.SHA1
          || param.type === VariableType.SHA256
          || param.type === VariableType.SIGHASHTYPE
          || param.type === VariableType.SIGHASHPREIMAGE
          || param.type === VariableType.OPCODETYPE) {
          contract.asmTemplateArgs.set(`$${param.name}`, '00');
        } else {
          throw new Error(`param ${param.name} has unknown type ${param.type}`);
        }

      } else {
        contract.asmTemplateArgs.set(`$${param.name}`, this.encodeParam(args_[index], param));
      }



    });

    contract.asmTemplateArgs.set('$__codePart__', 'OP_0');

    return new FunctionCall('constructor', { contract, lockingScriptASM: buildContractCodeASM(contract.asmTemplateArgs, asmTemplate), params: args });
  }

  encodeConstructorCallFromRawHex(contract: AbstractContract, asmTemplate: string, raw: string): FunctionCall {
    const script = bsv.Script.fromHex(raw);
    const constructorABI = this.abi.filter(entity => entity.type === ABIEntityType.CONSTRUCTOR)[0];
    const cParams = constructorABI?.params || [];
    const contractName = Object.getPrototypeOf(contract).constructor.contractName;

    const asmTemplateOpcodes = asmTemplate.split(' ');

    let lsASM = script.toASM();
    const asmOpcodes = lsASM.split(' ');

    if (asmTemplateOpcodes.length > asmOpcodes.length) {
      throw new Error(`the raw script cannot match the asm template of contract ${contractName}`);
    }

    if (asmTemplateOpcodes.length < asmOpcodes.length) {
      const opcode = asmOpcodes[asmTemplateOpcodes.length];
      if (opcode !== 'OP_RETURN') {
        throw new Error(`the raw script cannot match the asm template of contract ${contractName}`);
      }
    }

    asmTemplateOpcodes.forEach((opcode, index) => {

      if (opcode.startsWith('$')) {
        contract.asmTemplateArgs.set(opcode, asmOpcodes[index]);
      } else if (bsv.Script.fromASM(opcode).toHex() !== bsv.Script.fromASM(asmOpcodes[index]).toHex()) {
        throw new Error(`the raw script cannot match the asm template of contract ${contractName}`);
      }
    });

    const args: Arguments = cParams.map(p => ({
      type: this.finalTypeResolver(p.type),
      name: p.name,
      value: undefined,
      state: p.state
    })).map(param => {

      let value;

      if (isStructType(param.type)) {

        const stclass = contract.getTypeClassByType(getStructNameByType(param.type));

        value = createStruct(contract, stclass as typeof Struct, param.name, contract.asmTemplateArgs, this.finalTypeResolver);
      } else if (isArrayType(param.type)) {

        value = createArray(contract, param.type, param.name, contract.asmTemplateArgs, this.finalTypeResolver);

      } else {
        value = asm2ScryptType(param.type, contract.asmTemplateArgs.get(`$${param.name}`));
      }

      return {
        name: param.name,
        type: this.finalTypeResolver(param.type),
        state: param.state,
        value: value
      };

    });


    if (AbstractContract.isStateful(contract)) {


      const scriptHex = script.toHex();
      const metaScript = script.toHex().substr(scriptHex.length - 10, 10);
      const version = bin2num(metaScript.substr(metaScript.length - 2, 2)) as number;
      const stateLen = bin2num(metaScript.substr(0, 8)) as number;

      switch (version) {
        case 0:
          {
            const stateHex = scriptHex.substr(scriptHex.length - 10 - stateLen * 2, stateLen * 2);
            const opReturnHex = scriptHex.substr(scriptHex.length - 12 - stateLen * 2, 2);
            if (opReturnHex != '6a') {
              throw new Error('parse state fail, no OP_RETURN before state hex');
            }

            const br = new bsv.encoding.BufferReader(stateHex);

            args.forEach((arg) => {
              if (arg.state) {
                if (arg.type === VariableType.BOOL) {
                  const opcodenum = br.readUInt8();
                  arg.value = new Bool(opcodenum === 1);
                } else {
                  const { data } = readState(br);
                  if (arg.type === VariableType.INT || arg.type === VariableType.PRIVKEY) {
                    arg.value = new Int(bin2num(data));
                  } else if (arg.type === VariableType.BYTES) {
                    arg.value = new Bytes(data);
                  } else if (arg.type === VariableType.PUBKEY) {
                    arg.value = new PubKey(data);
                  } else if (arg.type === VariableType.SIG) {
                    arg.value = new Sig(data);
                  } else if (arg.type === VariableType.RIPEMD160) {
                    arg.value = new Ripemd160(data);
                  } else if (arg.type === VariableType.SHA1) {
                    arg.value = new Sha1(data);
                  } else if (arg.type === VariableType.SHA256) {
                    arg.value = new Sha256(data);
                  } else if (arg.type === VariableType.SIGHASHTYPE) {
                    arg.value = new SigHashType(bin2num(data) as number);
                  } else if (arg.type === VariableType.SIGHASHPREIMAGE) {
                    arg.value = new SigHashPreimage(data);
                  } else if (arg.type === VariableType.OPCODETYPE) {
                    arg.value = new OpCodeType(data);
                  } else {
                    //
                    throw new Error('unsupport type ' + arg.type);
                  }
                }
              }
            });
          }
          break;
      }

      lsASM = buildContractCodeASM(contract.asmTemplateArgs, asmTemplate);
    }

    return new FunctionCall('constructor', { contract, lockingScriptASM: lsASM, params: args.map(arg => arg.value) });

  }

  encodePubFunctionCall(contract: AbstractContract, name: string, args: SupportedParamType[]): FunctionCall {

    for (const entity of this.abi) {
      if (entity.name === name) {
        if (entity.params.length !== args.length) {
          throw new Error(`wrong number of arguments for #${name}, expected ${entity.params.length} but got ${args.length}`);
        }
        let asm = this.encodeParams(args, entity.params.map(p => ({
          name: p.name,
          type: this.finalTypeResolver(p.type),
          state: p.state
        })));
        if (this.abi.length > 2 && entity.index !== undefined) {
          // selector when there are multiple public functions
          const pubFuncIndex = entity.index;
          asm += ` ${int2Asm(pubFuncIndex.toString())}`;
        }
        return new FunctionCall(name, { contract, unlockingScriptASM: asm, params: args });
      }
    }

    throw new Error(`no function named '${name}' found in abi`);
  }

  encodeParams(args: SupportedParamType[], paramsEntitys: ParamEntity[]): string {
    return args.map((arg, i) => this.encodeParam(arg, paramsEntitys[i])).join(' ');
  }

  encodeParamArray(args: SupportedParamType[], arrayParam: ParamEntity): string {
    if (args.length === 0) {
      throw new Error('Empty array not allowed');
    }

    const t = typeof args[0];

    if (!args.every(arg => typeof arg === t)) {
      throw new Error('Array arguments are not of the same type');
    }

    if (checkArray(args, arrayParam.type)) {
      return flatternArray(args, arrayParam.name, arrayParam.type).map(arg => {
        return this.encodeParam(arg.value, { name: arg.name, type: this.finalTypeResolver(arg.type), state: arrayParam.state });
      }).join(' ');
    } else {
      throw new Error(`checkArray ${arrayParam.type} fail`);
    }
  }


  encodeParam(arg: SupportedParamType, paramEntity: ParamEntity): string {

    if (isArrayType(paramEntity.type)) {
      if (Array.isArray(arg)) {
        return this.encodeParamArray(arg, paramEntity);
      } else {
        const scryptType = typeOfArg(arg);
        throw new Error(`expect param ${paramEntity.name} as ${paramEntity.type} but got ${scryptType}`);
      }
    }

    if (isStructType(paramEntity.type)) {

      if (Struct.isStruct(arg)) {
        const argS = arg as Struct;
        if (paramEntity.type != argS.finalType) {
          throw new Error(`expect struct ${getStructNameByType(paramEntity.type)} but got struct ${argS.type}`);
        }
      } else {
        const scryptType = (arg as ScryptType).type;
        throw new Error(`expect param ${paramEntity.name} as struct ${getStructNameByType(paramEntity.type)} but got ${scryptType}`);
      }
    }


    const scryptType = typeOfArg(arg);
    if (scryptType != paramEntity.type) {
      throw new Error(`wrong argument type, expected ${paramEntity.type} but got ${scryptType}`);
    }

    const typeofArg = typeof arg;

    if (typeofArg === 'boolean') {
      arg = new Bool(arg as boolean);
    }

    if (typeofArg === 'number') {
      arg = new Int(arg as number);
    }

    if (typeofArg === 'bigint') {
      arg = new Int(arg as bigint);
    }

    if (typeof arg === 'string') {
      arg = new Int(arg as string);
    }

    return (arg as ScryptType).toASM();
  }

}