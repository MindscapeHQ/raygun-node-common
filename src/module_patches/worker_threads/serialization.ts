import * as BI from '../../bigint';

export function serialize(k: any, v: any) {
  if (BI.isBigInt(v)) {
    const serializedBigint = v.toString();

    return { _isBigInt: true, serializedBigint };
  }

  return v;
}

export function deserialize(k: any, v: any) {
  if (typeof v === 'object' && v._isBigInt) {
    return BI.BigInt(v.serializedBigint);
  }

  return v;
}
