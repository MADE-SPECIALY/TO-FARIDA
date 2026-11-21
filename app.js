import { buildLetterText, buildPersonalLetter, formatDate, formatTime, resolvePlan, yesButtonScale } from "./invitation-logic.mjs";

// 1) Get a free access key at https://web3forms.com (enter your email, the key arrives in your inbox)
// 2) Paste it below. Every answer will then be emailed to you.
const NOTIFY_KEY = "400accf0-3ec1-42a1-aad6-a0654e4057d1";

// Where her finished answers get texted to your phone (01012712021).
// Leave empty when the page is served by worker.js; on GitHub Pages put the
// deployed relay URL here, e.g. "https://to-farida-sms.your-name.workers.dev".
const SMS_RELAY_URL = "https://to-farida-sms-relay-no3ony.freebuff.site";
const SMS_ENDPOINT = SMS_RELAY_URL
  ? `${SMS_RELAY_URL.replace(/\/+$/, "")}/api/notify`
  : "/api/notify";

async function textAnswers(payload) {
  try {
    const response = await fetch(SMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false; // the letter still works and the email still goes out
  }
}

async function notify(subject, message) {
  if (!NOTIFY_KEY || NOTIFY_KEY.startsWith("PASTE")) return;
  try {
    await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ access_key: NOTIFY_KEY, subject, from_name: "Date invitation", message }),
    });
  } catch { /* never block the page if the email fails */ }
}

const state = {
  step: 1,
  noAttempts: 0,
  selectedPlan: "a candlelit dinner",
  details: null,
  generatedLetter: "",
  lastNo: null,
  lastReaction: -1,
  yesSent: false,
};

const $ = (selector) => document.querySelector(selector);
const steps = [$("#stepAsk"), $("#stepYay"), $("#stepPlan"), $("#stepLetter")];
const eyebrow = $("#eyebrow");
const cardCounter = $("#cardCounter");
const footerHint = $("#footerHint");
const reactionText = $("#reactionText");
const noButton = $("#noButton");
const actionZone = $("#actionZone");
const railFill = $("#railFill");
const progressSteps = [...document.querySelectorAll(".progress-step")];

const copy = {
  1: { eyebrow: "AN INVITATION FOR TWO", counter: "01", footer: "tap yes to continue" },
  2: { eyebrow: "A VERY GOOD DEVELOPMENT", counter: "02", footer: "the evening is yours" },
  3: { eyebrow: "PLANNING / YOUR DATE", counter: "03", footer: "choose your version of perfect" },
  4: { eyebrow: "PRIVATE DELIVERY / SEALED", counter: "04", footer: "keep this somewhere lovely" },
};

function setStep(nextStep) {
  state.step = nextStep;
  steps.forEach((step, index) => {
    const active = index === nextStep - 1;
    step.hidden = !active;
    step.classList.toggle("is-visible", active);
  });
  const meta = copy[nextStep];
  eyebrow.textContent = meta.eyebrow;
  cardCounter.textContent = meta.counter;
  footerHint.textContent = meta.footer;
  railFill.style.width = `${((nextStep - 1) / 3) * 100 + 12}%`;
  progressSteps.forEach((item, index) => {
    item.classList.toggle("is-active", index === nextStep - 1);
    item.classList.toggle("is-done", index < nextStep - 1);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function dodgeNoButton() {
  state.noAttempts += 1;
  const reactions = [
    "That button has stage fright.",
    "Nice try. It saw you coming.",
    "Faster than a runaway waiter.",
    "Destiny says: ask again.",
    "Okay, now it’s just being coy.",
    "Wrong button, gorgeous.",
    "It’s playing hard to get.",
    "That one’s not on the menu tonight.",
    "Plot twist: it ran away again.",
    "The other button looks lonely. Just saying.",
    "Almost had it. Almost.",
    "Careful, it bites. Kidding. It just hides.",
    "Even the candle is rooting for yes.",
    "Your finger says no, your heart says yes.",
    "This button is on a lifelong cardio journey.",
    "Look at that big, shiny yes. Right there.",
  ];
  let next;
  do { next = Math.floor(Math.random() * reactions.length); } while (reactions.length > 1 && next === state.lastReaction);
  state.lastReaction = next;
  reactionText.textContent = reactions[next];
  $("#yesButton").style.setProperty("--yes-grow", yesButtonScale(state.noAttempts));
  reactionText.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 230, easing: "ease-out" });

  const yesButton = $("#yesButton");
  const zoneRect = actionZone.getBoundingClientRect();
  const cardRect = $(".experience-card").getBoundingClientRect();
  const yesRect = yesButton.getBoundingClientRect();
  const w = noButton.offsetWidth;
  const h = noButton.offsetHeight;
  const scale = yesButtonScale(state.noAttempts);
  const pad = 18;

  // keep-out box around the "yes" button (grown to its final size, plus breathing room)
  const cx = yesRect.left + yesRect.width / 2;
  const cy = yesRect.top + yesRect.height / 2;
  const halfW = (yesButton.offsetWidth * scale) / 2 + pad;
  const halfH = (yesButton.offsetHeight * scale) / 2 + pad;
  const overlapsYes = (x, y) => x < cx + halfW && x + w > cx - halfW && y < cy + halfH && y + h > cy - halfH;

  // roam only in a small area around the buttons (still inside the card)
  const minX = Math.max(cardRect.left + 12, zoneRect.left - 8);
  const maxX = Math.min(cardRect.right - w - 12, zoneRect.right - w + 8);
  const minY = Math.max(cardRect.top + 12, zoneRect.top - 36);
  const maxY = Math.min(cardRect.bottom - h - 12, zoneRect.bottom - h + 36);

  let x = minX;
  let y = minY;
  let placed = false;
  for (let i = 0; i < 60 && !placed; i += 1) {
    x = minX + Math.random() * Math.max(0, maxX - minX);
    y = minY + Math.random() * Math.max(0, maxY - minY);
    const farFromLast = !state.lastNo || Math.hypot(x - state.lastNo.x, y - state.lastNo.y) > 70;
    placed = !overlapsYes(x, y) && farFromLast;
  }
  if (!placed) {
    // fallback: sit on whichever side of "yes" has more room
    const left = cx - halfW - w - 8 >= minX;
    x = left ? cx - halfW - w - 8 : Math.min(maxX, cx + halfW + 8);
    y = Math.min(maxY, Math.max(minY, cy - h / 2));
  }
  state.lastNo = { x, y };

  noButton.style.position = "absolute";
  noButton.style.zIndex = "3";
  noButton.style.left = `${x - zoneRect.left}px`;
  noButton.style.top = `${y - zoneRect.top}px`;
  noButton.style.transform = `rotate(${Math.round((Math.random() * 10) - 5)}deg)`;
}

function resetNoButton() {
  noButton.style.position = "static";
  noButton.style.left = "";
  noButton.style.top = "";
  noButton.style.zIndex = "";
  state.lastNo = null;
  noButton.style.transform = "";
}

$("#yesButton").addEventListener("click", () => {
  setStep(2);
  if (state.yesSent) return;
  state.yesSent = true;
  const tries = state.noAttempts;
  notify("She said YES ♥", `She said YES!\n\nTimes she tried to press "Not tonight": ${tries}`);
});
noButton.addEventListener("pointerenter", dodgeNoButton);
noButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  dodgeNoButton();
}, { passive: false });
noButton.addEventListener("click", (event) => event.preventDefault());
$("#detailsButton").addEventListener("click", () => setStep(3));

[...document.querySelectorAll(".plan-chip")].forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".plan-chip").forEach((item) => item.classList.remove("is-selected"));
    chip.classList.add("is-selected");
    state.selectedPlan = chip.dataset.plan;
  });
});

function fillLetter() {
  const name = $("#guestName").value.trim() || "you";
  const plan = resolvePlan($("#customPlan").value, state.selectedPlan);
  state.details = {
    name,
    date: $("#dateInput").value,
    time: $("#timeInput").value,
    plan,
  };
  return state.details;
}

function generateLetter(details) {
  const status = $("#aiStatus");
  const letterCopy = $("#letterCopy");
  state.generatedLetter = buildPersonalLetter(details);
  letterCopy.textContent = state.generatedLetter;
  status.textContent = "your words, translated for this date";
}

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type=submit]");
  submitButton.disabled = true;
  const details = fillLetter();
  setStep(4);
  generateLetter(details);
  submitButton.disabled = false;
  textAnswers({
    name: details.name,
    date: formatDate(details.date),
    time: formatTime(details.time),
    plan: details.plan,
    attempts: state.noAttempts,
    letter: state.generatedLetter,
  });
  notify("Her date details ♥", [
    "She picked the details:",
    "",
    `Name on the envelope: ${details.name}`,
    `Date: ${formatDate(details.date)}`,
    `Time: ${formatTime(details.time)}`,
    `Plan: ${details.plan}`,
    `Times she tried "Not tonight": ${state.noAttempts}`,
    "",
    "The letter she got:",
    state.generatedLetter,
  ].join("\n"));
});

$("#editButton").addEventListener("click", () => {
  resetNoButton();
  setStep(3);
});

function letterText() {
  return state.generatedLetter || buildLetterText(state.details || {});
}

$("#copyButton").addEventListener("click", async () => {
  const status = $("#copyStatus");
  try {
    await navigator.clipboard.writeText(letterText());
    status.textContent = "copied to your clipboard";
  } catch {
    status.textContent = "select the letter to copy";
  }
  setTimeout(() => { status.textContent = ""; }, 2600);
});

$("#shareButton").addEventListener("click", async () => {
  const payload = { title: "Date", text: letterText() };
  const status = $("#copyStatus");
  if (navigator.share) {
    try {
      await navigator.share(payload);
      status.textContent = "sent with love";
    } catch { /* user closed the share sheet */ }
  } else {
    await navigator.clipboard.writeText(letterText());
    status.textContent = "copied — share it anywhere";
  }
  setTimeout(() => { status.textContent = ""; }, 2600);
});

setStep(1);
