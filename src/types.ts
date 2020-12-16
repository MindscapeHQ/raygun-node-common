import { PortableBigInt } from "./bigint";

export type QueryInformation = {
  startTime: PortableBigInt;
  duration: PortableBigInt;

  provider: string;
  host: string;
  database: string;
  query: string;

  triggerAsyncId: number;
};

export type RequestDirection = "incoming" | "outgoing";

export type RequestInformation = {
  direction: RequestDirection;
  url: string;
  method: string;
  status: number;
  startTime: PortableBigInt;
  duration: PortableBigInt;
  triggerAsyncId: number;
};
