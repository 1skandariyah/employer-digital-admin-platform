const state = {
  bootstrap: null,
  session: null,
  stepIndex: 0,
  eligibilityChoice: null,
  dashboardUnlocked: false,
  enumeratorControls: false,
};

const landing = document.querySelector("#landing");
const dashboard = document.querySelector("#dashboard");
const respondent = document.querySelector("#respondent");
const respondentEntryForm = document.querySelector("#respondent-entry-form");
const respondentEntryStatus = document.querySelector("#respondent-entry-status");
const enumeratorLoginForm = document.querySelector("#enumerator-login-form");
const enumeratorLoginStatus = document.querySelector("#enumerator-login-status");
const sessionForm = document.querySelector("#session-form");
const sessionList = document.querySelector("#session-list");
const refreshButton = document.querySelector("#refresh-sessions");
const candidateCsvInput = document.querySelector("#candidate-csv");
const importCandidatesButton = document.querySelector("#import-candidates");
const candidateImportStatus = document.querySelector("#candidate-import-status");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

function moneyToInteger(value) {
  return Number(String(value).replace(/[^\d]/g, ""));
}

function formatStatus(session) {
  return `${session.response_count}/${session.expected_response_count} responses`;
}

function fillSelect(select, rows, labelKey = "name") {
  select.innerHTML = "";
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row[labelKey];
    select.append(option);
  });
}

async function loadBootstrap() {
  state.bootstrap = await api("/api/bootstrap");
  fillSelect(sessionForm.elements.enumeratorId, state.bootstrap.enumerators);
  fillSelect(sessionForm.elements.candidateSetId, state.bootstrap.candidateSets);
}

function showLanding() {
  landing.classList.remove("hidden");
  dashboard.classList.add("hidden");
  respondent.classList.add("hidden");
}

function sessionUrl(sessionId) {
  return `${location.origin}${location.pathname}?session=${sessionId}`;
}

async function loadSessions() {
  const { sessions } = await api("/api/sessions");
  sessionList.innerHTML = "";
  if (sessions.length === 0) {
    sessionList.innerHTML = "<p class=\"muted\">No sessions yet.</p>";
    return;
  }

  sessions.forEach((session) => {
    const row = document.createElement("article");
    row.className = "session-row";
    row.innerHTML = `
      <div>
        <h3>${session.employer_name}</h3>
        <p class="meta">
          ${session.business_name || "No business name"} - ${session.enumerator_name} -
          ${session.treatment_arm} - ${session.reveal_type} - ${session.mode} -
          ${session.candidate_count}/${session.requested_candidate_count} candidates
        </p>
        <p class="meta">
          Session code: ${session.id} -
          <a href="${sessionUrl(session.id)}" target="_blank" rel="noreferrer">Respondent link</a>
        </p>
        <span class="status">${session.status} - ${formatStatus(session)}</span>
      </div>
      <div class="session-actions">
        <button class="secondary delete-session" type="button">Delete session</button>
        <button class="open-session" type="button">Open session</button>
      </div>
    `;
    row.querySelector(".open-session").addEventListener("click", () => openSession(session.id, { enumeratorControls: true }));
    row.querySelector(".delete-session").addEventListener("click", () => deleteSession(session));
    sessionList.append(row);
  });
}

async function deleteSession(session) {
  const confirmed = window.confirm(
    `Delete session for ${session.employer_name}? This removes saved responses and randomization records for this session.`
  );
  if (!confirmed) {
    return;
  }
  await api(`/api/session/${session.id}`, { method: "DELETE" });
  await loadSessions();
}

function candidateById(candidateId) {
  return state.session.candidates.find((candidate) => candidate.id === candidateId);
}

function responseKey(candidateId, stage) {
  return `${candidateId}:${stage}`;
}

function existingResponsesMap() {
  const map = new Map();
  state.session.responses.forEach((response) => {
    map.set(responseKey(response.candidate_id, response.stage), response);
  });
  return map;
}

async function openSession(sessionId, options = {}) {
  state.session = await api(`/api/session/${sessionId}`);
  state.stepIndex = state.session.resumeStepIndex;
  state.eligibilityChoice = null;
  state.enumeratorControls = Boolean(options.enumeratorControls);
  landing.classList.add("hidden");
  dashboard.classList.add("hidden");
  respondent.classList.remove("hidden");
  renderStep();
}

function renderStep() {
  const step = state.session.flow[state.stepIndex];
  if (step.kind === "transparent_intro" || step.kind === "hidden_intro") {
    renderEligibilityIntro(step.kind);
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "transparent_productivity_definition") {
    renderInformationDefinition("transparent", step.info_type);
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "hidden_reveal_productivity_definition") {
    renderInformationDefinition("hidden_reveal", step.info_type);
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "candidate") {
    renderCandidate(step);
    addEnumeratorDashboardButton();
    return;
  }
  renderComplete();
  addEnumeratorDashboardButton();
}

function previousStep() {
  if (state.stepIndex === 0) {
    if (state.enumeratorControls) {
      returnToDashboardWithPasscode();
    } else {
      showLanding();
    }
    return;
  }
  const currentStep = state.session.flow[state.stepIndex];
  if (currentStep.kind === "hidden_reveal_productivity_definition") {
    return;
  }
  state.stepIndex -= 1;
  renderStep();
}

function nextStep() {
  state.stepIndex += 1;
  renderStep();
}

function navigationButtons(nextLabel = "Continue", options = {}) {
  const previousDisabled = options.disablePrevious ? "disabled" : "";
  return `
    <div class="nav-actions">
      <button class="secondary previous-screen" type="button" ${previousDisabled}>Previous</button>
      <button class="continue-screen" type="button">${nextLabel}</button>
    </div>
  `;
}

function attachNavigation(container, onNext = nextStep) {
  container.querySelector(".previous-screen").addEventListener("click", previousStep);
  container.querySelector(".continue-screen").addEventListener("click", onNext);
}

async function showDashboard() {
  state.dashboardUnlocked = true;
  landing.classList.add("hidden");
  respondent.classList.add("hidden");
  dashboard.classList.remove("hidden");
  await loadSessions();
}

function closePasscodeDialog() {
  document.querySelector(".passcode-backdrop")?.remove();
}

function returnToDashboardWithPasscode() {
  closePasscodeDialog();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="passcode-backdrop" role="presentation">
        <form class="passcode-dialog" aria-label="Enumerator passcode">
          <h2>Staff Passcode</h2>
          <label>
            Passcode
            <input name="passcode" type="password" inputmode="numeric" autocomplete="off" required>
          </label>
          <p class="passcode-error muted"></p>
          <div class="nav-actions">
            <button class="secondary cancel-passcode" type="button">Cancel</button>
            <button type="submit">Continue</button>
          </div>
        </form>
      </div>
    `
  );
  const dialog = document.querySelector(".passcode-dialog");
  const input = dialog.elements.passcode;
  input.focus();
  dialog.querySelector(".cancel-passcode").addEventListener("click", closePasscodeDialog);
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value !== "501") {
      dialog.querySelector(".passcode-error").textContent = "Incorrect passcode.";
      input.value = "";
      input.focus();
      return;
    }
    closePasscodeDialog();
    await showDashboard();
  });
}

function addEnumeratorDashboardButton() {
  if (!state.enumeratorControls) {
    return;
  }
  if (respondent.querySelector(".experiment-toolbar")) {
    return;
  }
  respondent.insertAdjacentHTML(
    "afterbegin",
    `
      <div class="experiment-toolbar">
        <button class="secondary dashboard-passcode" type="button">Staff access</button>
      </div>
    `
  );
  respondent.querySelector(".dashboard-passcode").addEventListener("click", returnToDashboardWithPasscode);
}

function renderEligibilityIntro(kind) {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Candidate Profile Review</h2>
      <p>
        In this session, you will review a number of candidate profiles relevant to entry-level
        social media management or related digital creative work. These profiles are constructed
        based on real resumes submitted by participants in our talent pool.
      </p>
      <p>
        Please review each candidate carefully and answer the follow-up questions based on your
        genuine assessment. Your careful and honest assessment of each profile is important because
        it helps identify candidates who may be suitable for social media admin or digital creative
        roles.
      </p>
      <p>
        Please also confirm that you are currently hiring or considering hiring someone for social
        media admin/social media manager-related position within the next 3 months.
      </p>
      <form id="eligibility-form">
        <div class="eligibility-options">
          <label>
            <input type="radio" name="eligibility" value="currently_hiring" required>
            <span>Yes, currently hiring</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="considering_hiring" required>
            <span>Yes, considering hiring within the next 3 months</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="not_eligible" required>
            <span>No</span>
          </label>
        </div>
        ${navigationButtons("Continue")}
      </form>
    </article>
  `;
  const form = respondent.querySelector("#eligibility-form");
  if (state.eligibilityChoice) {
    form.elements.eligibility.value = state.eligibilityChoice;
  }
  attachNavigation(respondent, () => {
    if (!form.reportValidity()) {
      return;
    }
    state.eligibilityChoice = form.elements.eligibility.value;
    if (state.eligibilityChoice === "not_eligible") {
      renderIneligibleEnd();
      return;
    }
    nextStep();
  });
}

function renderInformationDefinition(variant, infoType) {
  if (infoType === "placebo") {
    renderPlaceboDefinition(variant);
    return;
  }
  renderProductivityDefinition(variant);
}

function renderPlaceboDefinition(variant) {
  const isReveal = variant === "hidden_reveal";
  const title = isReveal
    ? "Additional Candidate Information"
    : "Candidate Information Note";
  const opening = isReveal
    ? `
      <p>Thank you. You have now completed the first review of all candidate profiles.</p>
      <p>
        In the next section, we will provide one additional non-performance detail for each
        candidate. This information is the candidate's hobby.
      </p>
      <p>
        Please review the same candidate profiles again with this additional information. As before,
        answer the follow-up questions based on your genuine assessment.
      </p>
    `
    : `
      <p>
        Candidate profiles are accompanied by one additional non-performance detail: the candidate's
        hobby.
      </p>
      <p>
        This hobby information is included as supplementary background information and is not a
        measure of candidate productivity or task performance.
      </p>
    `;

  respondent.innerHTML = `
    <article class="text-page">
      <h2>${title}</h2>
      ${opening}
      <p>
        Please use this information only as an additional reference when reviewing each candidate.
      </p>
      ${navigationButtons("Continue", { disablePrevious: isReveal })}
    </article>
  `;
  attachNavigation(respondent);
}

function renderProductivityDefinition(variant) {
  const isReveal = variant === "hidden_reveal";
  const title = isReveal
    ? "Additional Candidate Information"
    : "Candidate Performance Information";
  const opening = isReveal
    ? `
      <p>Thank you. You have now completed the first review of all candidate profiles.</p>
      <p>
        In the next section, we will provide additional information on each candidate's performance.
        This information comes from a standardized social media task completed by candidates over a
        three-week period.
      </p>
      <p>
        All candidates completed the task under the same general conditions. Each participant
        received the same participation compensation, and the three best performers received
        additional prizes. Participants were free to use any software or AI tools they chose to
        create content. However, they were not allowed to buy followers or generate fake interactions.
      </p>
      <p>
        The additional information is intended to help summarize how each candidate performed in
        managing social media content and attracting audience response.
      </p>
    `
    : `
      <p>
        Candidate profiles are accompanied by performance information generated
        through a standardized social media task. The performance numbers included in each
        candidate profile are based on a three-week task completed by our candidates in a
        competition setting, where we promised the same participation
        compensation to all participants and additional prizes for the three best performers.
      </p>
      <p>
        All participants were free to use any software or AI tools of their choice in creating
        content. However, participants were not allowed to buy followers or generate fake interactions.
      </p>
      <p>
        The performance indicators shown in the candidate profile are intended to summarize how well
        the candidate performed in managing social media content and attracting audience response.
      </p>
    `;

  respondent.innerHTML = `
    <article class="text-page">
      <h2>${title}</h2>
      ${opening}
      <p><strong>Definition of indicators</strong></p>
      <ul>
        <li>
          <strong>Reach-type indicator:</strong> the average number of accounts reached per post
          during the evaluation period.
        </li>
        <li>
          <strong>Interaction-type indicator:</strong> the average number of audience interactions
          per post during the evaluation period. Interactions are counted as likes or reactions,
          comments, shares, and saves combined.
        </li>
      </ul>
      <p>
        To help illustrate the relative performance of each candidate, we also provide the talent-pool
        median for the same indicators as a benchmark.
      </p>
      <p><strong>Benchmark of the talent pool</strong></p>
      <ul>
        <li>
          <strong>Median reach-type indicator: 950 accounts reached per post</strong>, meaning that
          around half of the participants were below this value and half were above it.
        </li>
        <li>
          <strong>Median interaction-type indicator: 54 interactions per post</strong>, meaning that
          around half of the participants were below this value and half were above it.
        </li>
      </ul>
      ${isReveal ? "" : "<p>Please use this information as an additional reference when evaluating each candidate.</p>"}
      ${navigationButtons("Continue", { disablePrevious: isReveal })}
    </article>
  `;
  attachNavigation(respondent);
}

function renderIneligibleEnd() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>End Screen</h2>
      <p>
        Thank you for your time. Based on the eligibility response, this session will not continue
        to the candidate evaluation screens.
      </p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Previous</button>
        <button class="continue-screen" type="button">${state.enumeratorControls ? "Return to dashboard" : "Return to start"}</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", renderStep);
  respondent.querySelector(".continue-screen").addEventListener("click", () => {
    if (state.enumeratorControls) {
      returnToDashboardWithPasscode();
      return;
    }
    showLanding();
  });
  addEnumeratorDashboardButton();
}

function renderComplete() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Session Complete</h2>
      <p>All required candidate profile reviews have been completed.</p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Previous</button>
        <button class="continue-screen" type="button">${state.enumeratorControls ? "Return to dashboard" : "Return to start"}</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", previousStep);
  respondent.querySelector(".continue-screen").addEventListener("click", () => {
    if (state.enumeratorControls) {
      returnToDashboardWithPasscode();
      return;
    }
    showLanding();
  });
}

function renderCandidate(step) {
  const template = document.querySelector("#candidate-template");
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".candidate-card");
  const candidate = candidateById(step.candidate_id);
  const response = existingResponsesMap().get(responseKey(candidate.id, step.stage));

  card.querySelector(".eyebrow").textContent = `Profile ${candidate.code}`;
  card.querySelector("h2").textContent = candidate.pseudonym;

  const grid = card.querySelector(".candidate-grid");
  Object.entries(candidate.baseline).forEach(([key, value]) => {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `<strong>${labelize(key)}</strong><span>${value}</span>`;
    grid.append(field);
  });

  const informationBlock = card.querySelector(".productivity-block");
  if (step.info_type === "productivity") {
    informationBlock.innerHTML = `<h3>Candidate Performance Information</h3>`;
    const benchmarkMedians = extractBenchmarkMedians(candidate.productivity.benchmark || "");
    Object.entries(candidate.productivity).forEach(([key, value]) => {
      if (key === "benchmark") {
        return;
      }
      const field = document.createElement("p");
      field.innerHTML = `<strong>${labelize(key)}:</strong> ${value}${medianSuffix(key, benchmarkMedians)}`;
      informationBlock.append(field);
    });
  } else if (step.info_type === "placebo") {
    informationBlock.classList.add("placeholder");
    informationBlock.innerHTML = `<h3>Candidate Additional Information</h3>`;
    Object.entries(candidate.placebo).forEach(([key, value]) => {
      const field = document.createElement("p");
      field.innerHTML = `<strong>${labelize(key)}:</strong> ${value}`;
      informationBlock.append(field);
    });
  } else {
    informationBlock.remove();
  }

  const form = card.querySelector(".response-form");
  const reasonOptions = card.querySelector(".reason-options");
  const rankedReasons = card.querySelector(".ranked-reasons");

  form.addEventListener("change", (event) => {
    if (event.target.name === "hireInterest") {
      renderReasons(form, reasonOptions, rankedReasons, null);
    }
  });
  form.querySelector(".previous-step").addEventListener("click", previousStep);
  form.addEventListener("submit", (event) => submitCandidateResponse(event, step, candidate));

  if (response) {
    form.elements.wageValue.value = response.wage_value;
    form.elements.conditionalWageOffer.value = response.conditional_wage_offer;
    form.elements.hireInterest.value = response.hire_interest;
  }

  renderReasons(form, reasonOptions, rankedReasons, response);
  respondent.innerHTML = "";
  respondent.append(card);
}

function renderReasons(form, reasonOptions, rankedReasons, response) {
  const hireInterest = form.elements.hireInterest.value;
  reasonOptions.innerHTML = "";
  rankedReasons.innerHTML = "";
  if (!hireInterest) {
    reasonOptions.innerHTML = "<p class=\"muted\">Choose hiring interest first.</p>";
    return;
  }

  const canUseSavedReasons = response && response.hire_interest === hireInterest;
  const selected = new Set(canUseSavedReasons ? JSON.parse(response.selected_reasons_json) : []);
  const ranked = canUseSavedReasons ? JSON.parse(response.ranked_reasons_json) : [];
  const reasons = state.session.reasons.filter((reason) => reason.applies_to === hireInterest);

  reasons.forEach((reason) => {
    const line = document.createElement("label");
    line.className = "reason-line";
    line.innerHTML = `
      <input type="checkbox" name="reason" value="${reason.id}">
      <span>${reason.label}</span>
      <input name="rank-${reason.id}" inputmode="numeric" min="1" placeholder="Rank">
    `;
    const checkbox = line.querySelector("input[type=checkbox]");
    const rank = line.querySelector(`input[name="rank-${reason.id}"]`);
    checkbox.checked = selected.has(reason.id);
    const rankIndex = ranked.indexOf(reason.id);
    if (rankIndex >= 0) {
      rank.value = rankIndex + 1;
    }
    reasonOptions.append(line);
  });
}

async function submitCandidateResponse(event, step, candidate) {
  event.preventDefault();
  const form = event.currentTarget;
  const selectedReasons = [...form.querySelectorAll("input[name=reason]:checked")].map((input) => Number(input.value));
  const rankedReasons = selectedReasons
    .map((reasonId) => ({
      reasonId,
      rank: Number(form.elements[`rank-${reasonId}`].value || 0),
    }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.reasonId);

  if (!selectedReasons.length) {
    alert("Please select at least one reason.");
    return;
  }
  if (rankedReasons.length !== selectedReasons.length) {
    alert("Please rank every selected reason.");
    return;
  }

  await api(`/api/session/${state.session.session.id}/response`, {
    method: "POST",
    body: JSON.stringify({
      candidateId: candidate.id,
      stage: step.stage,
      wageValue: moneyToInteger(form.elements.wageValue.value),
      hireInterest: form.elements.hireInterest.value,
      selectedReasons,
      rankedReasons,
      conditionalWageOffer: moneyToInteger(form.elements.conditionalWageOffer.value),
      startedAt: new Date().toISOString(),
    }),
  });

  state.session = await api(`/api/session/${state.session.session.id}`);
  state.stepIndex += 1;
  renderStep();
}

function labelize(key) {
  if (key === "gpa") {
    return "GPA";
  }
  const labels = {
    reach_indicator: "Reach-type indicator",
    interaction_indicator: "Interaction-type indicator",
    benchmark: "Talent-pool benchmark",
  };
  if (labels[key]) {
    return labels[key];
  }
  return key.replaceAll("_", " ");
}

function extractBenchmarkMedians(benchmarkText) {
  const reachMatch = benchmarkText.match(/([\d,]+)\s+accounts reached per post/i);
  const interactionMatch = benchmarkText.match(/([\d,]+)\s+interactions per post/i);
  return {
    reach: reachMatch ? reachMatch[1] : "",
    interaction: interactionMatch ? interactionMatch[1] : "",
  };
}

function medianSuffix(key, medians) {
  if (key === "reach_indicator" && medians.reach) {
    return ` (Median: ${medians.reach})`;
  }
  if (key === "interaction_indicator" && medians.interaction) {
    return ` (Median: ${medians.interaction})`;
  }
  return "";
}

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.randomizationSeed) {
    delete data.randomizationSeed;
  }
  const { sessionId } = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  form.reset();
  await loadBootstrap();
  await loadSessions();
  await openSession(sessionId, { enumeratorControls: true });
});

refreshButton.addEventListener("click", loadSessions);

respondentEntryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sessionId = respondentEntryForm.elements.sessionId.value.trim();
  respondentEntryStatus.textContent = "";
  try {
    await openSession(sessionId);
  } catch (error) {
    respondentEntryStatus.textContent = error.message;
  }
});

enumeratorLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const passcode = enumeratorLoginForm.elements.passcode.value;
  if (passcode !== "501") {
    enumeratorLoginStatus.textContent = "Incorrect passcode.";
    enumeratorLoginForm.elements.passcode.value = "";
    enumeratorLoginForm.elements.passcode.focus();
    return;
  }
  enumeratorLoginStatus.textContent = "";
  enumeratorLoginForm.reset();
  await showDashboard();
});

importCandidatesButton.addEventListener("click", async () => {
  const file = candidateCsvInput.files[0];
  if (!file) {
    candidateImportStatus.textContent = "Choose a CSV file first.";
    return;
  }
  const csvText = await file.text();
  const response = await fetch("/api/candidates/import", {
    method: "POST",
    headers: { "Content-Type": "text/csv; charset=utf-8" },
    body: csvText,
  });
  const result = await response.json();
  if (!response.ok) {
    candidateImportStatus.textContent = result.error || "Import failed.";
    return;
  }
  candidateImportStatus.textContent = `Imported ${result.imported} candidate rows.`;
  candidateCsvInput.value = "";
  await loadBootstrap();
});

loadBootstrap()
  .then(async () => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    if (sessionId) {
      await openSession(sessionId);
      return;
    }
    showLanding();
  })
  .catch((error) => {
    document.body.innerHTML = `<main><section class="panel"><h2>Startup error</h2><p>${error.message}</p></section></main>`;
  });
