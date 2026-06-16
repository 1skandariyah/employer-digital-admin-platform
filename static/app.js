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

const BENCHMARK_RANGES = {
  reach_indicator: {
    min: 320,
    median: 950,
    max: 4100,
    unit: "accounts reached per post",
  },
  interaction_indicator: {
    min: 12,
    median: 54,
    max: 280,
    unit: "interactions per post",
  },
};

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
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return Number.NaN;
  }
  return Number(normalized);
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
  if (step.kind === "employer_characteristics") {
    renderEmployerCharacteristics();
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
    returnHomeWithPasscode();
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

function requestPasscode(title, onSuccess) {
  closePasscodeDialog();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="passcode-backdrop" role="presentation">
        <form class="passcode-dialog" aria-label="Enumerator passcode">
          <h2>${title}</h2>
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
    await onSuccess();
  });
}

function returnToDashboardWithPasscode() {
  requestPasscode("Staff Passcode", showDashboard);
}

function returnHomeWithPasscode() {
  requestPasscode("Home Passcode", async () => {
    state.enumeratorControls = false;
    showLanding();
  });
}

function addEnumeratorDashboardButton() {
  if (respondent.querySelector(".experiment-toolbar")) {
    return;
  }
  respondent.insertAdjacentHTML(
    "afterbegin",
    `
      <div class="experiment-toolbar">
        <button class="secondary home-passcode" type="button">Home</button>
      </div>
    `
  );
  respondent.querySelector(".home-passcode").addEventListener("click", returnHomeWithPasscode);
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
        it will help identify candidates who best suit your social media and digital creative role
        requirements.
      </p>
      <p>
        Are you currently hiring or planning to hire someone for a social media admin, social media
        manager, or related digital creative position within the next 3 months?
      </p>
      <form id="eligibility-form">
        <div class="eligibility-options">
          <label>
            <input type="radio" name="eligibility" value="currently_hiring" required>
            <span>Yes, currently hiring</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="considering_hiring" required>
            <span>Yes, planning to hire within the next 3 months</span>
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

function radioOptions(name, options) {
  return options.map(([value, label]) => `
    <label class="compact-option">
      <input type="radio" name="${name}" value="${value}" required>
      <span>${label}</span>
    </label>
  `).join("");
}

function renderEmployerCharacteristics() {
  const currentYear = new Date().getFullYear();
  respondent.innerHTML = `
    <article class="characteristics-page">
      <div class="characteristics-heading">
        <div>
          <h2>About You and Your Business</h2>
          <p class="muted">Please answer the following questions before reviewing the candidate profiles.</p>
        </div>
      </div>
      <form id="characteristics-form">
        <div class="characteristics-grid">
          <section class="characteristics-section">
            <h3>A. Respondent characteristics</h3>
            <fieldset class="compact-fieldset">
              <legend>A1. Gender</legend>
              <div class="compact-options">
                ${radioOptions("gender", [["male", "Male"], ["female", "Female"], ["prefer_not_to_say", "Prefer not to say"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A2. Date of birth</legend>
              <div class="inline-inputs">
                <label>Month
                  <select name="birthMonth" required>
                    <option value="">Select</option>
                    ${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("")}
                  </select>
                </label>
                <label>Year
                  <input name="birthYear" type="number" min="1900" max="${currentYear - 15}" step="1" required>
                </label>
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A3. Highest level of education completed</legend>
              <div class="compact-options">
                ${radioOptions("education", [
                  ["primary_or_below", "Primary school or below"],
                  ["junior_secondary", "Junior secondary school"],
                  ["senior_or_vocational", "Senior secondary / vocational high school"],
                  ["diploma", "Diploma"],
                  ["bachelor", "Bachelor's degree"],
                  ["master_or_above", "Master's degree or above"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A4. Role in the business</legend>
              <div class="compact-options">
                ${radioOptions("businessRole", [
                  ["owner", "Owner"], ["co_owner", "Co-owner"], ["manager", "Manager"],
                  ["hr_recruitment", "HR / recruitment staff"], ["other", "Other"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessRoleOther" placeholder="Please specify role">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>B. Business characteristics</h3>
            <fieldset class="compact-fieldset">
              <legend>B1. Main business sector</legend>
              <div class="compact-options">
                ${radioOptions("businessSector", [
                  ["manufacturing", "Manufacturing"],
                  ["accommodation_food", "Accommodation and food service activities"],
                  ["wholesale_retail", "Wholesale and retail trade"],
                  ["personal_services", "Other personal service activities (beauty services)"],
                  ["other", "Other sector"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessSectorOther" placeholder="Please specify sector">
            </fieldset>
            <div class="compact-pair">
              <label><strong>B2. Year business was established</strong>
                <input name="establishedYear" type="number" min="1800" max="${currentYear}" step="1" required>
              </label>
              <fieldset class="compact-fieldset">
                <legend>B3. Number of workers</legend>
                <div class="compact-options two-up">
                  ${radioOptions("workers", [["1_4", "1–4"], ["5_19", "5–19"], ["20_99", "20–99"], ["100_plus", "100 or more"]])}
                </div>
              </fieldset>
            </div>
            <fieldset class="compact-fieldset">
              <legend>B4. Approximate annual revenue</legend>
              <div class="compact-options">
                ${radioOptions("annualRevenue", [
                  ["less_300m", "Less than IDR 300 million"],
                  ["300m_to_2_5b", "IDR 300 million to less than IDR 2.5 billion"],
                  ["2_5b_to_50b", "IDR 2.5 billion to less than IDR 50 billion"],
                  ["50b_plus", "IDR 50 billion or more"],
                  ["prefer_not_to_say", "Prefer not to say"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>B5. Business location</legend>
              <div class="inline-inputs">
                <label>City<input name="city" required></label>
                <label>Province<input name="province" required></label>
              </div>
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>C. Digital-related activity</h3>
            <fieldset class="compact-fieldset">
              <legend>C2. Current use of social media for business</legend>
              <p class="compact-prompt">Does your business currently have an active social media account for marketing or sales purposes?</p>
              <div class="compact-options two-up">
                ${radioOptions("activeSocialMedia", [["yes", "Yes"], ["no", "No"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset platforms-fieldset">
              <legend>C3. Platforms currently used</legend>
              <p class="compact-prompt">Select all that apply.</p>
              <div class="compact-options two-up platform-options">
                ${[
                  ["instagram", "Instagram"], ["tiktok", "TikTok"], ["facebook", "Facebook"],
                  ["whatsapp_business", "WhatsApp Business"], ["youtube", "YouTube"],
                  ["x_twitter", "X / Twitter"], ["other", "Other"],
                ].map(([value, label]) => `
                  <label class="compact-option">
                    <input type="checkbox" name="platforms" value="${value}">
                    <span>${label}</span>
                  </label>
                `).join("")}
              </div>
              <input class="conditional-other hidden" name="platformOther" placeholder="Please specify platform">
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C4. Previous hiring experience</legend>
              <p class="compact-prompt">Has your business hired someone specifically to manage social media, content, or digital promotion before?</p>
              <div class="compact-options two-up">
                ${radioOptions("previousDigitalHiring", [["yes", "Yes"], ["no", "No"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C5. Most recent work arrangement</legend>
              <p class="compact-prompt">What arrangement was most recently used, or do you plan to use for the next hiring?</p>
              <div class="compact-options">
                ${radioOptions("workArrangement", [
                  ["full_time", "Full-time employee"], ["part_time", "Part-time employee"],
                  ["freelancer", "Freelancer / project-based worker"],
                  ["family_informal", "Family member / informal help"], ["other", "Other"],
                ])}
              </div>
              <input class="conditional-other hidden" name="workArrangementOther" placeholder="Please specify arrangement">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>E. Participation motivation</h3>
            <fieldset class="compact-fieldset">
              <legend>E1. Importance of participation fee</legend>
              <p class="compact-prompt">How important is the participation fee in motivating you to participate in this session?</p>
              <div class="importance-scale">
                ${radioOptions("participationFeeImportance", [["1", "1 Not important"], ["2", "2 Slightly"], ["3", "3 Moderately"], ["4", "4 Important"], ["5", "5 Very important"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>E2. Importance of candidate-matching benefit</legend>
              <p class="compact-prompt">How important is the possibility of being matched with potential candidates in motivating you to participate in this session?</p>
              <div class="importance-scale">
                ${radioOptions("matchingBenefitImportance", [["1", "1 Not important"], ["2", "2 Slightly"], ["3", "3 Moderately"], ["4", "4 Important"], ["5", "5 Very important"]])}
              </div>
            </fieldset>
          </section>
        </div>
        <div class="nav-actions">
          <button class="secondary previous-characteristics" type="button">Previous</button>
          <button type="submit">Save and continue</button>
        </div>
      </form>
    </article>
  `;

  const form = respondent.querySelector("#characteristics-form");
  populateCharacteristicsForm(form, state.session.characteristics);
  attachCharacteristicsConditions(form);
  form.querySelector(".previous-characteristics").addEventListener("click", previousStep);
  form.addEventListener("submit", submitEmployerCharacteristics);
}

function populateCharacteristicsForm(form, saved) {
  if (!saved) return;
  const values = {
    gender: saved.gender,
    birthMonth: saved.birth_month,
    birthYear: saved.birth_year,
    education: saved.education,
    businessRole: saved.business_role,
    businessRoleOther: saved.business_role_other,
    businessSector: saved.business_sector,
    businessSectorOther: saved.business_sector_other,
    establishedYear: saved.established_year,
    workers: saved.workers,
    annualRevenue: saved.annual_revenue,
    city: saved.city,
    province: saved.province,
    activeSocialMedia: saved.active_social_media,
    platformOther: saved.platform_other,
    previousDigitalHiring: saved.previous_digital_hiring,
    workArrangement: saved.work_arrangement,
    workArrangementOther: saved.work_arrangement_other,
    participationFeeImportance: saved.participation_fee_importance,
    matchingBenefitImportance: saved.matching_benefit_importance,
  };
  Object.entries(values).forEach(([name, value]) => {
    if (value !== undefined && value !== null && form.elements[name]) {
      form.elements[name].value = value;
    }
  });
  (saved.platforms || []).forEach((platform) => {
    const checkbox = form.querySelector(`input[name="platforms"][value="${platform}"]`);
    if (checkbox) checkbox.checked = true;
  });
}

function attachCharacteristicsConditions(form) {
  const toggleOther = (name, expectedValue, otherName) => {
    const selected = form.elements[name].value;
    const input = form.elements[otherName];
    const active = selected === expectedValue;
    input.classList.toggle("hidden", !active);
    input.required = active;
    if (!active) input.value = "";
  };
  const togglePlatformOther = () => {
    const otherChecked = Boolean(form.querySelector('input[name="platforms"][value="other"]:checked'));
    const input = form.elements.platformOther;
    input.classList.toggle("hidden", !otherChecked);
    input.required = otherChecked;
    if (!otherChecked) input.value = "";
  };
  const togglePlatforms = () => {
    const active = form.elements.activeSocialMedia.value === "yes";
    form.querySelector(".platforms-fieldset").classList.toggle("disabled-section", !active);
    form.querySelectorAll('input[name="platforms"]').forEach((input) => {
      input.disabled = !active;
      if (!active) input.checked = false;
    });
    if (!active) form.elements.platformOther.value = "";
    togglePlatformOther();
  };

  form.addEventListener("change", (event) => {
    if (event.target.name === "businessRole") toggleOther("businessRole", "other", "businessRoleOther");
    if (event.target.name === "businessSector") toggleOther("businessSector", "other", "businessSectorOther");
    if (event.target.name === "workArrangement") toggleOther("workArrangement", "other", "workArrangementOther");
    if (event.target.name === "activeSocialMedia") togglePlatforms();
    if (event.target.name === "platforms") togglePlatformOther();
  });

  toggleOther("businessRole", "other", "businessRoleOther");
  toggleOther("businessSector", "other", "businessSectorOther");
  toggleOther("workArrangement", "other", "workArrangementOther");
  togglePlatforms();
}

async function submitEmployerCharacteristics(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  data.platforms = [...form.querySelectorAll('input[name="platforms"]:checked')].map((input) => input.value);
  if (data.activeSocialMedia === "yes" && data.platforms.length === 0) {
    alert("Please select at least one social media platform currently used.");
    return;
  }
  await api(`/api/session/${state.session.session.id}/characteristics`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  state.session = await api(`/api/session/${state.session.session.id}`);
  state.stepIndex += 1;
  renderStep();
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
        In the next section, we will provide one additional personal detail for each candidate.
      </p>
      <p>
        Please review the same candidate profiles again with this additional information. As before,
        answer the follow-up questions based on your genuine assessment.
      </p>
    `
    : `
      <p>
        Candidate profiles are accompanied by one additional personal detail.
      </p>
      <p>
        This detail is included as supplementary background information and is not a measure of
        candidate productivity or task performance.
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
        We understand that it can be difficult to judge how well a candidate will perform in this
        role based on a profile alone. For this reason, all candidates completed a standardized
        social media performance test.
      </p>
      <p>
        The test took place over three weeks in a competition setting. All candidates completed it
        under the same general conditions and received the same participation compensation, while
        the three best performers received additional prizes. Candidates were free to use any
        software or AI tools to create content, but they were not allowed to buy followers or
        generate fake interactions.
      </p>
      <p>
        In the next section, the candidate profiles will include information from this test to
        summarize how each candidate performed in managing social media content and attracting
        audience response.
      </p>
    `
    : `
      <p>
        We understand that it can be difficult to judge how well a candidate will perform in this
        role based on a profile alone. For this reason, all candidates completed a standardized
        social media performance test.
      </p>
      <p>
        The test took place over three weeks in a competition setting. All candidates completed it
        under the same general conditions and received the same participation compensation, while
        the three best performers received additional prizes. Candidates were free to use any
        software or AI tools to create content, but they were not allowed to buy followers or
        generate fake interactions.
      </p>
      <p>
        The performance information shown in each candidate profile summarizes how the candidate
        performed in managing social media content and attracting audience response during the test.
      </p>
    `;

  respondent.innerHTML = `
    <article class="text-page productivity-info-page">
      <h2>${title}</h2>
      <div class="productivity-info-copy">
        ${opening}
        <p>
          To help illustrate the relative performance of each candidate, we also provide the
          talent-pool minimum, median, and maximum for the same indicators as a benchmark.
        </p>
        <p><strong>Benchmark of the talent pool</strong></p>
        <ul>
          <li>
            <strong>Reach-type indicator:</strong> minimum 320, median 950, and maximum 4,100
            accounts reached per post.
          </li>
          <li>
            <strong>Interaction-type indicator:</strong> minimum 12, median 54, and maximum 280
            interactions per post.
          </li>
        </ul>
        ${isReveal ? "" : "<p>Please use this information as an additional reference when evaluating each candidate.</p>"}
      </div>
      <section class="metric-examples" aria-label="Examples of performance indicators">
        <h3>Definition of indicators</h3>
        <article class="metric-example">
          <p>
            <strong>Reach-type indicator:</strong> the average number of accounts reached per post
            during the evaluation period. This is not the same as views; it refers to the number of
            unique accounts reached by the post.
          </p>
          <img src="/assets/reach-example.jpg" alt="Example platform insight showing accounts reached">
          <p>
            <strong>Example of reach:</strong> the post has 14,545 views, but it reached 5,543
            accounts. For the reach-type indicator, we use accounts reached.
          </p>
        </article>
        <article class="metric-example">
          <p>
            <strong>Interaction-type indicator:</strong> the average number of audience interactions
            per post during the evaluation period. Interactions are counted as likes or reactions,
            comments, reposts, shares, and saves combined.
          </p>
          <img src="/assets/interaction-example.jpg" alt="Example platform insight showing likes, comments, reposts, shares, and saves">
          <p>
            <strong>Example of interaction:</strong> direct interactions are likes, comments,
            reposts, shares, and saves. In this example, the interaction total is
            133 + 13 + 9 + 3 + 5 = 163.
          </p>
        </article>
      </section>
      <p class="muted">
        These screenshots are examples only. Candidate-specific values will be shown on each
        candidate profile.
      </p>
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
    Object.entries(candidate.productivity).forEach(([key, value]) => {
      if (key === "benchmark") {
        return;
      }
      const field = document.createElement("div");
      field.className = "performance-metric";
      field.innerHTML = `
        <p><strong>${labelize(key)}:</strong> ${formatCandidateMetric(key, value, candidate.pseudonym)}</p>
        ${renderBenchmarkScale(key, value, candidate.pseudonym)}
      `;
      informationBlock.append(field);
    });
  } else if (step.info_type === "placebo") {
    informationBlock.classList.add("placeholder");
    informationBlock.innerHTML = `<h3>Additional Information</h3>`;
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
      form.dataset.reasonsConfirmed = "";
      form.dataset.offerConfirmed = "";
      renderReasons(form, reasonOptions, rankedReasons, null);
    }
    updateCandidateProgression(form);
  });
  form.elements.wageValue.addEventListener("input", () => updateCandidateProgression(form));
  form.elements.wageValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmWageStep(form);
    }
  });
  form.elements.conditionalWageOffer.addEventListener("input", () => {
    form.dataset.offerConfirmed = "";
    updateCandidateProgression(form);
  });
  form.elements.conditionalWageOffer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmOfferStep(form);
    }
  });
  form.querySelector(".wage-next").addEventListener("click", () => confirmWageStep(form));
  form.querySelector(".reasons-done").addEventListener("click", () => confirmReasonsStep(form));
  form.querySelector(".offer-next").addEventListener("click", () => confirmOfferStep(form));
  form.querySelector(".previous-step").addEventListener("click", previousStep);
  form.addEventListener("submit", (event) => submitCandidateResponse(event, step, candidate));

  if (response) {
    form.dataset.wageConfirmed = "true";
    form.dataset.reasonsConfirmed = "true";
    form.dataset.offerConfirmed = "true";
    form.elements.wageValue.value = response.wage_value;
    form.elements.conditionalWageOffer.value = response.conditional_wage_offer;
    form.elements.hireInterest.value = response.hire_interest;
  }

  renderReasons(form, reasonOptions, rankedReasons, response);
  updateCandidateProgression(form, Boolean(response));
  respondent.innerHTML = "";
  respondent.append(card);
}

function setProgressiveFieldset(fieldset, visible) {
  fieldset.classList.toggle("progressive-concealed", !visible);
  fieldset.disabled = !visible;
}

function updateCandidateProgression(form, revealAll = false) {
  const wageAnswered = Number.isSafeInteger(moneyToInteger(form.elements.wageValue.value));
  if (!wageAnswered) {
    form.dataset.wageConfirmed = "";
    form.dataset.reasonsConfirmed = "";
    form.dataset.offerConfirmed = "";
  }
  form.querySelector(".wage-next").disabled = !wageAnswered;

  const wageConfirmed = revealAll || form.dataset.wageConfirmed === "true";
  const hiringVisible = wageAnswered && wageConfirmed;
  setProgressiveFieldset(form.querySelector(".question-hiring"), hiringVisible);

  const hiringAnswered = hiringVisible && Boolean(form.elements.hireInterest.value);
  const reasonsVisible = revealAll || hiringAnswered;
  setProgressiveFieldset(form.querySelector(".question-reasons"), reasonsVisible);

  const hasSelectedReason = form.querySelectorAll("input[name=reason]:checked").length > 0;
  if (!hasSelectedReason) {
    form.dataset.offerConfirmed = "";
  }
  form.querySelector(".reasons-done").disabled = !(reasonsVisible && hasSelectedReason);

  const reasonsConfirmed = revealAll || form.dataset.reasonsConfirmed === "true";
  const offerVisible = reasonsVisible && hasSelectedReason && reasonsConfirmed;
  setProgressiveFieldset(form.querySelector(".question-offer"), offerVisible);

  const offerAnswered = Number.isSafeInteger(moneyToInteger(form.elements.conditionalWageOffer.value));
  form.querySelector(".offer-next").disabled = !(offerVisible && offerAnswered);

  const offerConfirmed = revealAll || form.dataset.offerConfirmed === "true";
  form.querySelector(".save-candidate-response").disabled = !(offerVisible && offerAnswered && offerConfirmed);
}

function confirmWageStep(form) {
  const wageAnswered = Number.isSafeInteger(moneyToInteger(form.elements.wageValue.value));
  if (!wageAnswered) {
    form.elements.wageValue.reportValidity();
    return;
  }
  form.dataset.wageConfirmed = "true";
  updateCandidateProgression(form);
  form.elements.hireInterest[0]?.focus();
}

function confirmReasonsStep(form) {
  const hasSelectedReason = form.querySelectorAll("input[name=reason]:checked").length > 0;
  if (!hasSelectedReason) {
    alert("Please select at least one reason before continuing.");
    return;
  }
  form.dataset.reasonsConfirmed = "true";
  form.dataset.offerConfirmed = "";
  updateCandidateProgression(form);
  form.elements.conditionalWageOffer.focus();
}

function confirmOfferStep(form) {
  const offerAnswered = Number.isSafeInteger(moneyToInteger(form.elements.conditionalWageOffer.value));
  if (!offerAnswered) {
    form.elements.conditionalWageOffer.reportValidity();
    return;
  }
  form.dataset.offerConfirmed = "true";
  updateCandidateProgression(form);
  form.querySelector(".save-candidate-response").focus();
}

function renderReasons(form, reasonOptions, rankedReasons, response) {
  const hireInterest = form.elements.hireInterest.value;
  const reasonsLegend = form.querySelector(".reasons-legend");
  reasonOptions.innerHTML = "";
  rankedReasons.innerHTML = "";
  if (!hireInterest) {
    reasonsLegend.textContent = "Reason for hiring / not hiring";
    reasonOptions.innerHTML = "<p class=\"muted\">Choose hiring interest first.</p>";
    return;
  }

  reasonsLegend.textContent = hireInterest === "yes" ? "Reasons for hiring" : "Reasons for not hiring";

  const canUseSavedReasons = response && response.hire_interest === hireInterest;
  const selected = new Set(canUseSavedReasons ? JSON.parse(response.selected_reasons_json) : []);
  const ranked = canUseSavedReasons ? JSON.parse(response.ranked_reasons_json) : [];
  const savedScores = canUseSavedReasons && response.reason_scores_json
    ? JSON.parse(response.reason_scores_json)
    : {};
  const reasons = state.session.reasons.filter((reason) => reason.applies_to === hireInterest);

  reasons.forEach((reason) => {
    const line = document.createElement("label");
    line.className = "reason-line";
    line.innerHTML = `
      <input type="checkbox" name="reason" value="${reason.id}">
      <span>${reason.label}</span>
      <span class="reason-rating">
        <input type="range" name="score-${reason.id}" min="0" max="100" step="1" value="50" disabled>
        <output>50</output>
      </span>
    `;
    const checkbox = line.querySelector("input[type=checkbox]");
    const score = line.querySelector(`input[name="score-${reason.id}"]`);
    const output = line.querySelector("output");
    checkbox.checked = selected.has(reason.id);
    const savedScore = savedScores[String(reason.id)];
    const legacyRankIndex = ranked.indexOf(reason.id);
    if (savedScore !== undefined) {
      score.value = savedScore;
    } else if (legacyRankIndex >= 0) {
      score.value = Math.max(0, 100 - legacyRankIndex * 25);
    }
    score.disabled = !checkbox.checked;
    output.textContent = score.value;
    checkbox.addEventListener("change", () => {
      score.disabled = !checkbox.checked;
      form.dataset.reasonsConfirmed = "";
      form.dataset.offerConfirmed = "";
      updateCandidateProgression(form);
    });
    score.addEventListener("input", () => {
      output.textContent = score.value;
    });
    reasonOptions.append(line);
  });
}

async function submitCandidateResponse(event, step, candidate) {
  event.preventDefault();
  const form = event.currentTarget;
  const wageValue = moneyToInteger(form.elements.wageValue.value);
  const conditionalWageOffer = moneyToInteger(form.elements.conditionalWageOffer.value);
  if (!Number.isSafeInteger(wageValue) || !Number.isSafeInteger(conditionalWageOffer)) {
    alert("Please enter both salary amounts as whole numbers only.");
    return;
  }
  const selectedReasons = [...form.querySelectorAll("input[name=reason]:checked")].map((input) => Number(input.value));
  const reasonScores = Object.fromEntries(
    selectedReasons.map((reasonId) => [reasonId, Number(form.elements[`score-${reasonId}`].value)])
  );
  const rankedReasons = selectedReasons
    .map((reasonId) => ({
      reasonId,
      score: reasonScores[reasonId],
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.reasonId);

  if (!selectedReasons.length) {
    alert("Please select at least one reason.");
    return;
  }
  await api(`/api/session/${state.session.session.id}/response`, {
    method: "POST",
    body: JSON.stringify({
      candidateId: candidate.id,
      stage: step.stage,
      wageValue,
      hireInterest: form.elements.hireInterest.value,
      selectedReasons,
      rankedReasons,
      reasonScores,
      conditionalWageOffer,
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

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function parseMetricValue(text) {
  const match = String(text).match(/:\s*([\d,]+)/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function formatCandidateMetric(key, textValue, candidateName) {
  const value = parseMetricValue(textValue);
  const formattedValue = Number.isFinite(value) ? formatNumber(value) : textValue;
  if (key === "reach_indicator") {
    return `Average accounts reached per post by ${candidateName}: ${formattedValue}`;
  }
  if (key === "interaction_indicator") {
    return `Average interactions per post by ${candidateName}: ${formattedValue}`;
  }
  return textValue;
}

function benchmarkPosition(value, range) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= range.median) {
    const lowerSpan = Math.max(1, range.median - range.min);
    return Math.max(0, Math.min(50, ((value - range.min) / lowerSpan) * 50));
  }
  const upperSpan = Math.max(1, range.max - range.median);
  return Math.max(50, Math.min(100, 50 + ((value - range.median) / upperSpan) * 50));
}

function renderBenchmarkScale(key, textValue, candidateName) {
  const range = BENCHMARK_RANGES[key];
  if (!range) {
    return "";
  }
  const candidateValue = parseMetricValue(textValue);
  const markerPosition = benchmarkPosition(candidateValue, range);
  const candidateLabel = Number.isFinite(candidateValue)
    ? `<p class="scale-caption">${candidateName} performance: ${formatNumber(candidateValue)} ${range.unit}</p>`
    : "";
  return `
    <div class="benchmark-scale" style="--candidate-position: ${markerPosition}%">
      <div class="scale-track" aria-hidden="true">
        <span class="scale-tick scale-min"></span>
        <span class="scale-tick scale-median"></span>
        <span class="scale-tick scale-max"></span>
        ${Number.isFinite(candidateValue) ? "<span class=\"candidate-marker\"></span>" : ""}
      </div>
      <div class="scale-labels">
        <span>Min ${formatNumber(range.min)}</span>
        <span>Median ${formatNumber(range.median)}</span>
        <span>Max ${formatNumber(range.max)}</span>
      </div>
      ${candidateLabel}
    </div>
  `;
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
