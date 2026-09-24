// Local visual fixture only. Every answer, profile and token below is synthetic.
import { createNoahController } from "../../src/ui/noah.js";

const DEMO_PROPOSAL_ID = "00000000-0000-4000-8000-000000000001";
const proposal = () => ({
  id: DEMO_PROPOSAL_ID, status: "pending", title: "월 매출 목표 변경",
  changes: [{ label: "월 매출 목표", before: "3,000,000원", after: "3,500,000원" }],
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
});
const navigation = document.querySelector("#fixtureNavigation");
const acknowledgements = new Map();
let epoch = 1;
let phase = "beforeShift";
let failOnce = true;
const client = {
  auth: { getSession: async () => ({ data: { session: { access_token: "fixture-only-token" } } }) },
  async rpc(name) {
    if (name === "quickflex_noah_acknowledge_notice") {
      const timestamp = new Date().toISOString();
      acknowledgements.set(`fixture-user-${epoch}`, timestamp);
      return { data: timestamp };
    }
    if (name === "quickflex_noah_submit_feedback") {
      navigation.textContent = "모의 평가가 접수됐어요. 실제 서버에는 전송하지 않았습니다.";
      return { data: true };
    }
    return { error: { message: "unknown fixture RPC" } };
  },
  functions: {
    async invoke(_name, { body }) {
      if (body.operation === "confirm") return { data: { proposal: { ...proposal(), status: "confirmed" }, message: "모의 변경을 완료했어요." } };
      if (body.operation === "cancel") return { data: { proposal: { ...proposal(), status: "cancelled" }, message: "모의 제안을 취소했어요." } };
      if (body.message.includes("통신 실패") && failOnce) {
        failOnce = false;
        return { error: { message: "fixture offline" } };
      }
      return { data: { answer: "연결을 다시 확인했어요. 이것은 모의 답변입니다.", model: "fixture-model", proposals: [], sources: [] } };
    },
  },
};
function fixtureFetch(_url, { body, signal }) {
  const question = JSON.parse(body).message;
  if (question.includes("통신 실패")) return Promise.reject(new Error("fixture network error"));
  const answer = question.includes("변경")
    ? "변경 내용을 확인해 주세요. 이것은 모의 제안입니다."
    : "이번 주 모의 매출은 720,000원입니다. 이 수치는 화면 검증을 위한 예시입니다.";
  const payload = { answer, model: "fixture-model", proposals: question.includes("변경") ? [proposal()] : [],
    sources: ["sales_days", "finance_summary"], links: [{ kind: "stats", target: { from: "2026-09-21", to: "2026-09-27" } }], elapsedMs: 420 };
  const encoder = new TextEncoder();
  const events = [
    `event: progress\ndata: ${JSON.stringify({ message: "모의 기록을 찾고 있어요." })}\n\n`,
    `event: delta\ndata: ${JSON.stringify({ text: answer.slice(0, 18) })}\n\n`,
    `event: delta\ndata: ${JSON.stringify({ text: answer.slice(18) })}\n\n`,
    `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
  ];
  return Promise.resolve(new Response(new ReadableStream({
    async start(stream) {
      for (const event of events) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        if (signal.aborted) { stream.close(); return; }
        stream.enqueue(encoder.encode(event));
      }
      stream.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }));
}
function create() {
  return createNoahController({
    thread: document.querySelector("#noahThread"), form: document.querySelector("#noahAskForm"),
    input: document.querySelector("#noahInput"), suggestions: document.querySelector(".noah-suggestions"),
    getContext: () => ({ client, userId: `fixture-user-${epoch}`, epoch, approved: true,
      noticeAcknowledgedAt: acknowledgements.get(`fixture-user-${epoch}`), supabaseUrl: "https://fixture.invalid", anonKey: "fixture-anon-key" }),
    getBriefingContext: () => ({ phase, workShift: "night", nextWorkDate: "2026-09-25", workDateLabel: "9/25",
      workDateCaption: "오늘 밤 9/25 마감", routes: ["302B"], routeTipCount: 3, goalRequiredPerDay: 82000 }),
    onNoticeAcknowledged: (timestamp) => { navigation.textContent = `모의 계정의 안내 확인: ${timestamp}`; },
    onNavigate: (link) => { navigation.textContent = `모의 이동: ${link.kind} ${JSON.stringify(link.target)}`; },
    onChanged: () => { navigation.textContent = "모의 데이터 갱신 완료"; },
    fetcher: fixtureFetch,
  });
}
let controller = create();
for (const control of document.querySelectorAll("[data-example]")) control.addEventListener("click", () => { void controller.ask(control.dataset.example); });
for (const control of document.querySelectorAll("[data-phase]")) control.addEventListener("click", () => {
  phase = control.dataset.phase;
  void controller.open();
});
document.querySelector("[data-restore]").addEventListener("click", () => {
  controller.destroy(); controller = create(); navigation.textContent = "이 기기의 저장된 대화를 다시 불러왔어요.";
});
document.querySelector("[data-switch-account]").addEventListener("click", () => {
  epoch += 1; controller.reset(); navigation.textContent = `모의 계정 ${epoch}로 전환했어요.`;
});
