export type OcrRequest = {
  imageBase64?: string;
  mimeType?: string;
  ownerName?: string;
  year?: number;
  month?: number;
  kind?: "schedule" | "settlement";
  // 셀 단위 OCR 모드 (브라우저에서 표 분할 후 셀 이미지만 전송)
  mode?: "schedule" | "cells" | "vision-schedule";
  cells?: CellOcrInput[];
};

export type CellOcrInput = {
  id: string;          // 클라이언트가 지정하는 식별자 (응답 매핑용)
  base64: string;      // data URL prefix 없는 순수 base64
  mimeType?: string;   // 미지정 시 image/jpeg
};

export type CellOcrResult = {
  id: string;
  text: string;
  confidence?: number;
};

export type CellOcrResponse = {
  provider: string;
  results: CellOcrResult[];
};

export type ScheduleMap = Record<string, string[] | null>;

export type SettlementRow = {
  route: string;
  date?: string;
  deliveryCount: number;
  amount: number;
  extraIncentive?: number;
};

export type OcrHarnessInput = {
  imageBase64: string;
  mimeType: string;
  ownerName: string;
  year: number;
  month: number;
};

export type OcrHarnessResult = {
  schedule: ScheduleMap;
  rawText: string;
  provider: string;
  model: string;
};

export type SettlementOcrResult = {
  settlement: {
    rows: SettlementRow[];
  };
  rawText: string;
  provider: string;
  model: string;
};

export interface ScheduleOcrProvider {
  readonly name: string;
  readonly model: string;
  extractSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult>;
  extractSettlement(input: OcrHarnessInput): Promise<SettlementOcrResult>;
}
