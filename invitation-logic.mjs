export function formatDate(value) {
  if (!value) return "a date we'll choose together";
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function formatTime(value) {
  if (!value) return "a time that feels right";
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function resolvePlan(customPlan, selectedPlan) {
  return customPlan?.trim() || selectedPlan;
}

export function yesButtonScale(attempts) {
  return Math.min(1.6, 1 + Math.max(0, attempts) * 0.08);
}

export function buildPersonalLetter({ date, time, plan }) {
  return `I've always been waiting for the moment when we could finally go out together, and honestly, I can't wait. I love you so much, and I can't wait to sit across from you and look into your eyes. It really will be a special day with you, Om Ahmed, and Nour.\n\nYours, Aloosh\n\nOur date: ${formatDate(date)} at ${formatTime(time)} — ${plan}.`;
}

export function buildLetterText({ name, date, time, plan }) {
  const safeName = name?.trim() || "you";
  return `Dear ${safeName},\n\nSo... it's official. It's a date.\n\nLet's meet on ${formatDate(date)} at ${formatTime(time)} for ${plan}.\n\nI'll pick the table. You bring that smile you get when dessert arrives.\n\nYours,\nthe person who asked`;
}
