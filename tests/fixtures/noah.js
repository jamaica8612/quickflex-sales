// Local visual fixture only. No Supabase client, account, or persistent data.
import { createNoahController } from "../../src/ui/noah.js";

const DEMO_PROPOSAL_ID = "00000000-0000-4000-8000-000000000001";
const proposal = () => ({
  id: DEMO_PROPOSAL_ID, status: "pending", title: "월 매출 목표 변경",
  changes: [{ label: "월 매출 목표", before: "3,000,000원", after: "3,500,000원" }],
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});
let failOnce = true;
const client = {
  functions: {
    async invoke(_name, { body, signal }) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 350);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }, { once: true });
      });
      if (body.operation === "confirm") return { data: { proposal: { ...proposal(), status: "confirmed" }, message: "모의 변경을 완료했어요." } };
      if (body.operation === "cancel") return { data: { proposal: { ...proposal(), status: "cancelled" }, message: "모의 제안을 취소했어요." } };
      if (body.message.includes("통신 실패") && failOnce) {
        failOnce = false;
        return { error: { message: "offline" } };
      }
      if (body.message.includes("변경")) return { data: { answer: "변경 내용을 확인해 주세요.", model: "gpt-6-luna", proposals: [proposal()], sources: ["profile"] } };
      return { data: { answer: "이번 주 모의 매출은 720,000원입니다. 이 수치는 화면 검증을 위한 예시입니다.", model: "gpt-6-luna", proposals: [], sources: ["sales_days", "finance_summary"] } };
    },
  },
};
let epoch = 1;
const controller = createNoahController({
  thread: document.querySelector("#noahThread"), form: document.querySelector("#noahAskForm"),
  input: document.querySelector("#noahInput"), suggestions: document.querySelector(".noah-suggestions"),
  getContext: () => ({ client, userId: `fixture-user-${epoch}`, epoch, approved: true }),
  onChanged: () => {},
});
for (const button of document.querySelectorAll("[data-example]")) button.addEventListener("click", () => controller.ask(button.dataset.example));
document.querySelector("[data-switch-account]").addEventListener("click", () => { epoch++; controller.reset(); });
