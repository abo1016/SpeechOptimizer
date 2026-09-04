// Responses API 最小夹具：output_text 内是符合严格 Schema 的 JSON 字符串。
export const openAiFeedbackFixture = {
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ items: [{
    priority: "high",
    issue: "The opening is too dense.",
    evidence: "The first sentence contains several ideas without a pause.",
    revision: "Split the opening into two short sentences.",
    rerecordPrompt: "Rerecord the opening with one brief pause.",
  }] }) }] }],
  usage: { input_tokens: 100, output_tokens: 50 },
};
