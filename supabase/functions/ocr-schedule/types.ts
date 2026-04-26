export type OcrRequest = {
  imageBase64?: string;
  mimeType?: string;
  ownerName?: string;
  year?: number;
  month?: number;
};

export type ScheduleMap = Record<string, string[] | null>;

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

export interface ScheduleOcrProvider {
  readonly name: string;
  readonly model: string;
  extractSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult>;
}
