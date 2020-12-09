import JSBI from 'jsbi';

export type PortableBigInt = bigint | JSBI;

type BigIntOperations<T> = {
  add(a: T, b: T): T;
  subtract(a: T, b: T): T;
  multiply(a: T, b: T): T;
  divide(a: T, b: T): T;
  signedRightShift(a: T, b: T): T;
  bitwiseAnd(a: T, b: T): T;
  BigInt(a: number): T;
  toNumber(b: T): number;
  isBigInt(v: any): v is T;
  greaterThan(a: T, b: T): boolean;
  lessThan(a: T, b: T): boolean;
  now(): T;
  zero: T;
};

const output: BigIntOperations<PortableBigInt> = {
  add: JSBI.add,
  subtract: JSBI.subtract,
  multiply: JSBI.multiply,
  divide: JSBI.divide,
  signedRightShift: JSBI.signedRightShift,
  bitwiseAnd: JSBI.bitwiseAnd,
  greaterThan: JSBI.greaterThan,
  lessThan: JSBI.lessThan,
  BigInt: JSBI.BigInt,
  isBigInt: (v: any): v is JSBI => typeof v === 'object' && v instanceof JSBI,
  toNumber: JSBI.toNumber,

  now(): PortableBigInt {
    const hr = process.hrtime();
    return JSBI.BigInt(Math.round(hr[0] * 1e6 + hr[1] / 1000));
  },

  zero: JSBI.BigInt(0),
};

function isBigIntDefined(): boolean {
  try {
    return typeof BigInt('1') === 'bigint';
  } catch (e) {
    return false;
  }
}

if (isBigIntDefined() && !process.env['RAYGUN_APM_PREFER_JSBI']) {
  function add(a: bigint, b: bigint): bigint {
    return a + b;
  }
  function subtract(a: bigint, b: bigint): bigint {
    return a - b;
  }
  function multiply(a: bigint, b: bigint): bigint {
    return a * b;
  }
  function divide(a: bigint, b: bigint): bigint {
    return a / b;
  }
  function signedRightShift(a: bigint, b: bigint): bigint {
    return a >> b;
  }
  function bitwiseAnd(a: bigint, b: bigint): bigint {
    return a & b;
  }
  function greaterThan(a: bigint, b: bigint): boolean {
    return a > b;
  }
  function lessThan(a: bigint, b: bigint): boolean {
    return a < b;
  }
  function isBigInt(a: any): a is bigint {
    return typeof a === 'bigint';
  }
  const TIME_DIVISOR = BigInt(1000);
  function now(): bigint {
    return process.hrtime.bigint() / TIME_DIVISOR;
  }
  output.BigInt = (n: number) => BigInt(n);
  output.add = add;
  output.subtract = subtract;
  output.multiply = multiply;
  output.divide = divide;
  output.signedRightShift = signedRightShift;
  output.bitwiseAnd = bitwiseAnd;
  output.greaterThan = greaterThan;
  output.lessThan = lessThan;
  output.toNumber = (b: bigint): number => Number(b);
  output.isBigInt = isBigInt;
  output.now = now;
  output.zero = BigInt(0);
}

const BI = output.BigInt;

export { BI as BigInt };

export const {
  now,
  add,
  subtract,
  multiply,
  divide,
  signedRightShift,
  bitwiseAnd,
  greaterThan,
  lessThan,
  toNumber,
  isBigInt,
  zero,
} = output;
