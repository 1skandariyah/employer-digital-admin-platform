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
const experimentHeaderActions = document.querySelector("#experiment-header-actions");
const respondentEntryForm = document.querySelector("#respondent-entry-form");
const respondentEntryStatus = document.querySelector("#respondent-entry-status");
const enumeratorLoginForm = document.querySelector("#enumerator-login-form");
const enumeratorLoginStatus = document.querySelector("#enumerator-login-status");
const quickCreateSessionButton = document.querySelector("#quick-create-session");
const sessionForm = document.querySelector("#session-form");
const sessionCreateStatus = document.querySelector("#session-create-status");
const sessionList = document.querySelector("#session-list");
const refreshButton = document.querySelector("#refresh-sessions");
const candidateCsvInput = document.querySelector("#candidate-csv");
const importCandidatesButton = document.querySelector("#import-candidates");
const candidateImportStatus = document.querySelector("#candidate-import-status");

const BENCHMARK_RANGES = {
  reach_indicator: {
    min: 100,
    median: 500,
    max: 2500,
    unit: "akun dijangkau per postingan",
  },
  interaction_indicator: {
    min: 3,
    median: 25,
    max: 150,
    unit: "interaksi per postingan",
  },
};

const CONDITIONAL_REASON_LABELS = {
  productivity: {
    yes: "Kinerja tugas mengesankan",
    no: "Kinerja tugas mengecewakan",
  },
  placebo: {
    yes: "Informasi Tambahan menunjukkan kecocokan yang baik",
    no: "Informasi Tambahan menunjukkan kecocokan yang kurang baik",
  },
};

const CONDITIONAL_REASON_LABEL_SET = new Set(
  Object.values(CONDITIONAL_REASON_LABELS).flatMap((labels) => Object.values(labels))
);
const OTHER_REASON_LABEL = "Alasan lain (sebutkan)";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Permintaan gagal" }));
    throw new Error(error.error || "Permintaan gagal");
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
  return `${session.response_count}/${session.expected_response_count} respons`;
}

function treatmentLabel(treatmentArm) {
  const labels = {
    hidden: "Tersembunyi",
    hidden_placebo: "Tersembunyi + informasi tambahan",
    transparent: "Terbuka",
    transparent_placebo: "Terbuka + informasi tambahan",
  };
  return labels[treatmentArm] || treatmentArm;
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
  experimentHeaderActions.classList.add("hidden");
}

function sessionLocator(session) {
  return session.session_code || String(session.id);
}

function sessionUrl(session) {
  return `${location.origin}${location.pathname}?session=${encodeURIComponent(sessionLocator(session))}`;
}

async function loadSessions() {
  const { sessions } = await api("/api/sessions");
  sessionList.innerHTML = "";
  if (sessions.length === 0) {
    sessionList.innerHTML = "<p class=\"muted\">Belum ada sesi.</p>";
    return;
  }

  sessions.forEach((session) => {
    const row = document.createElement("article");
    row.className = "session-row";
    row.innerHTML = `
      <div>
        <h3>${session.employer_name}</h3>
        <p class="meta">
          ${session.business_name || "Nama usaha belum diisi"} - ${session.enumerator_name} -
          ${treatmentLabel(session.treatment_arm)} - ${session.mode} -
          ${session.candidate_count}/${session.requested_candidate_count} kandidat
        </p>
        <p class="meta">
          Kode sesi: <strong>${sessionLocator(session)}</strong> -
          <a href="${sessionUrl(session)}" target="_blank" rel="noreferrer">Tautan responden</a>
        </p>
        <span class="status">${session.status} - ${formatStatus(session)}</span>
      </div>
      <div class="session-actions">
        <button class="secondary rename-session-code" type="button">Ubah kode</button>
        <button class="secondary delete-session" type="button">Hapus sesi</button>
        <button class="open-session" type="button">Buka sesi</button>
      </div>
    `;
    row.querySelector(".open-session").addEventListener("click", () => openSession(session.id, { enumeratorControls: true }));
    row.querySelector(".rename-session-code").addEventListener("click", () => renameSessionCode(session));
    row.querySelector(".delete-session").addEventListener("click", () => deleteSession(session));
    sessionList.append(row);
  });
}

async function renameSessionCode(session) {
  const currentCode = sessionLocator(session);
  const newCode = window.prompt("Masukkan kode sesi baru", currentCode);
  if (newCode === null) {
    return;
  }
  const trimmed = newCode.trim();
  if (!trimmed || trimmed === currentCode) {
    return;
  }
  await api(`/api/session/${encodeURIComponent(session.id)}/code`, {
    method: "POST",
    body: JSON.stringify({ sessionCode: trimmed }),
  });
  await loadSessions();
}

async function deleteSession(session) {
  const confirmed = window.confirm(
    `Hapus sesi untuk ${session.employer_name}? Ini akan menghapus respons tersimpan dan catatan randomisasi untuk sesi ini.`
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

function existingDraftsMap() {
  const map = new Map();
  (state.session.drafts || []).forEach((draft) => {
    map.set(responseKey(draft.candidate_id, draft.stage), draft.response);
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
  if (step.kind === "candidate_review_intro") {
    renderCandidateReviewIntro();
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "transparent_productivity_definition") {
    renderProductivityDefinition("transparent");
    addEnumeratorDashboardButton();
    return;
  }
  if (step.kind === "hidden_reveal_productivity_definition") {
    renderProductivityDefinition("hidden_reveal");
    addEnumeratorDashboardButton();
    return;
  }
  if (
    step.kind === "transparent_productivity_reading" ||
    step.kind === "hidden_reveal_productivity_reading"
  ) {
    renderProductivityReadingGuide();
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
    requestPasscode("Passcode Staf", async () => {
      state.stepIndex -= 1;
      renderStep();
    });
    return;
  }
  state.stepIndex -= 1;
  renderStep();
}

function nextStep() {
  state.stepIndex += 1;
  renderStep();
}

function navigationButtons(nextLabel = "Lanjut", options = {}) {
  const previousDisabled = options.disablePrevious ? "disabled" : "";
  return `
    <div class="nav-actions">
      <button class="secondary previous-screen" type="button" ${previousDisabled}>Sebelumnya</button>
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
  experimentHeaderActions.classList.add("hidden");
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
        <form class="passcode-dialog" aria-label="Passcode enumerator">
          <h2>${title}</h2>
          <label>
            Passcode
            <input name="passcode" type="password" inputmode="numeric" autocomplete="off" required>
          </label>
          <p class="passcode-error muted"></p>
          <div class="nav-actions">
            <button class="secondary cancel-passcode" type="button">Batal</button>
            <button type="submit">Lanjut</button>
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
      dialog.querySelector(".passcode-error").textContent = "Passcode salah.";
      input.value = "";
      input.focus();
      return;
    }
    closePasscodeDialog();
    await onSuccess();
  });
}

function returnToDashboardWithPasscode() {
  requestPasscode("Passcode Staf", showDashboard);
}

function closeQuickCreateDialog() {
  document.querySelector(".quick-create-backdrop")?.remove();
}

function openQuickCreateDialog() {
  closeQuickCreateDialog();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="passcode-backdrop quick-create-backdrop" role="presentation">
        <form class="quick-create-dialog" id="quick-create-form" aria-label="Buat sesi terpandu baru">
          <h2>Buat Sesi Baru</h2>
          <p class="muted">Lengkapi detail sesi, lalu buat sesi terpandu.</p>
          <div class="quick-create-grid">
            <label>
              Nama responden
              <input name="employerName" required placeholder="Nama responden">
            </label>
            <label>
              Kode sesi
              <input name="sessionCode" placeholder="Opsional, mis. PILOT-A1">
            </label>
            <label>
              Nama usaha
              <input name="businessName" placeholder="Nama UMKM">
            </label>
            <label>
              Kontak
              <input name="contact" placeholder="Nomor telepon atau email">
            </label>
            <label>
              Enumerator
              <select name="enumeratorId" required></select>
            </label>
            <label>
              Kelompok perlakuan
              <select name="treatmentArm" required>
                <option value="hidden">Tersembunyi</option>
                <option value="hidden_placebo">Tersembunyi + informasi tambahan</option>
                <option value="transparent">Terbuka</option>
                <option value="transparent_placebo">Terbuka + informasi tambahan</option>
              </select>
            </label>
            <label>
              Set kandidat
              <select name="candidateSetId" required></select>
            </label>
            <label>
              Jumlah kandidat yang dinilai
              <select name="candidateLimit" required>
                <option value="3">3 kandidat</option>
                <option value="5">5 kandidat</option>
                <option value="10">10 kandidat</option>
                <option value="15">15 kandidat</option>
                <option value="20" selected>20 kandidat</option>
              </select>
            </label>
            <label>
              Mode pelaksanaan
              <select name="mode" required>
                <option value="online">Terpandu online</option>
                <option value="offline">Terpandu offline</option>
              </select>
            </label>
            <label>
              Seed randomisasi
              <input name="randomizationSeed" inputmode="numeric" placeholder="Opsional">
            </label>
          </div>
          <p class="quick-create-status muted" aria-live="polite"></p>
          <div class="nav-actions">
            <button class="secondary quick-create-cancel" type="button">Batal</button>
            <button type="submit">Buat sesi terpandu</button>
          </div>
        </form>
      </div>
    `
  );
  const form = document.querySelector("#quick-create-form");
  fillSelect(form.elements.enumeratorId, state.bootstrap.enumerators);
  fillSelect(form.elements.candidateSetId, state.bootstrap.candidateSets);
  form.elements.employerName.focus();
  form.querySelector(".quick-create-cancel").addEventListener("click", closeQuickCreateDialog);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const created = await createSessionFromForm(
      form,
      form.querySelector(".quick-create-status")
    );
    if (!created) {
      return;
    }
    closeQuickCreateDialog();
    await loadBootstrap();
    await loadSessions();
    await openSession(created.sessionId, { enumeratorControls: true });
  });
}

function requestQuickCreateSession() {
  requestPasscode("Passcode Staf", openQuickCreateDialog);
}

function returnHomeWithPasscode() {
  requestPasscode("Passcode Beranda", async () => {
    state.enumeratorControls = false;
    showLanding();
  });
}

function addEnumeratorDashboardButton() {
  experimentHeaderActions.classList.remove("hidden");
}

experimentHeaderActions.querySelector(".home-passcode").addEventListener("click", returnHomeWithPasscode);
quickCreateSessionButton.addEventListener("click", requestQuickCreateSession);

function renderEligibilityIntro(kind) {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Pengantar Sesi</h2>
      <p>
        Terima kasih telah bergabung dalam sesi ini.
      </p>
      <p>
        Dalam sesi ini, kami ingin memahami preferensi Anda saat mempertimbangkan kandidat
        untuk posisi admin media sosial, manajer media sosial, atau pekerjaan kreatif digital terkait.
      </p>
      <p>
        Sebelum melanjutkan, kami perlu mengetahui apakah usaha Anda saat ini sedang merekrut atau
        berencana merekrut seseorang untuk posisi seperti ini. Kami juga akan menanyakan beberapa
        pertanyaan tentang Anda dan usaha Anda sebelum penilaian kandidat dimulai.
      </p>
      <p>
        Sebagai apresiasi atas waktu dan partisipasi Anda, Anda akan menerima biaya partisipasi
        sebesar IDR 350.000 setelah menyelesaikan sesi ini.
      </p>
      <p>
        Selain itu, penilaian Anda yang cermat akan membantu kami mengidentifikasi kandidat dari
        kumpulan talenta kami yang mungkin cocok untuk kebutuhan posisi Anda. <strong>Hal ini dapat
        membantu mengurangi waktu dan usaha yang dibutuhkan dalam proses rekrutmen Anda.</strong>
        Oleh karena itu, mohon menilai setiap bagian sesi ini secara serius dan menjawab berdasarkan
        penilaian Anda yang sebenarnya.
      </p>
      <p>
        Apakah saat ini Anda sedang merekrut atau berencana merekrut seseorang untuk posisi admin
        media sosial, manajer media sosial, atau pekerjaan kreatif digital terkait dalam 3 bulan ke depan?
      </p>
      <form id="eligibility-form">
        <div class="eligibility-options">
          <label>
            <input type="radio" name="eligibility" value="currently_hiring" required>
            <span>Ya, saat ini sedang merekrut</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="considering_hiring" required>
            <span>Ya, berencana merekrut dalam 3 bulan ke depan</span>
          </label>
          <label>
            <input type="radio" name="eligibility" value="not_eligible" required>
            <span>Tidak</span>
          </label>
        </div>
        ${navigationButtons("Lanjut")}
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

function renderCandidateReviewIntro() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Penilaian Profil Kandidat</h2>
      <p>
        Dalam sesi ini, Anda akan menilai sejumlah profil kandidat yang relevan untuk posisi
        awal pengelolaan media sosial atau pekerjaan kreatif digital terkait. Profil-profil ini
        disusun berdasarkan resume nyata yang dikumpulkan dari peserta dalam kumpulan talenta kami.
      </p>
      <p>
        Mohon menilai setiap kandidat dengan cermat dan menjawab pertanyaan lanjutan berdasarkan
        penilaian Anda yang sebenarnya. Penilaian Anda yang cermat dan jujur atas setiap profil
        penting karena akan membantu mengidentifikasi kandidat yang <strong>paling sesuai</strong>
        dengan kebutuhan posisi media sosial dan kreatif digital Anda.
      </p>
      ${navigationButtons("Lanjut")}
    </article>
  `;
  attachNavigation(respondent);
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
  const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  respondent.innerHTML = `
    <article class="characteristics-page">
      <div class="characteristics-heading">
        <div>
          <h2>Tentang Anda dan Usaha Anda</h2>
          <p class="muted">Mohon jawab pertanyaan berikut sebelum menilai profil kandidat.</p>
        </div>
      </div>
      <form id="characteristics-form">
        <div class="characteristics-grid">
          <section class="characteristics-section">
            <h3>A. Karakteristik responden</h3>
            <fieldset class="compact-fieldset">
              <legend>A1. Jenis kelamin</legend>
              <div class="compact-options">
                ${radioOptions("gender", [["male", "Laki-laki"], ["female", "Perempuan"], ["prefer_not_to_say", "Memilih untuk tidak menjawab"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A2. Tanggal lahir</legend>
              <div class="inline-inputs">
                <label>Bulan
                  <select name="birthMonth" required>
                    <option value="">Pilih</option>
                    ${monthNames.map((month, index) => `<option value="${index + 1}">${month}</option>`).join("")}
                  </select>
                </label>
                <label>Tahun
                  <input class="year-input" name="birthYear" type="number" min="1900" max="${currentYear - 15}" step="1" inputmode="numeric" required>
                </label>
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A3. Tingkat pendidikan tertinggi yang diselesaikan</legend>
              <div class="compact-options">
                ${radioOptions("education", [
                  ["primary_or_below", "Sekolah dasar atau di bawahnya"],
                  ["junior_secondary", "Sekolah menengah pertama"],
                  ["senior_or_vocational", "SMA / SMK"],
                  ["diploma", "Diploma"],
                  ["bachelor", "Sarjana"],
                  ["master_or_above", "Magister atau lebih tinggi"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>A4. Peran dalam usaha</legend>
              <div class="compact-options">
                ${radioOptions("businessRole", [
                  ["owner", "Pemilik"], ["co_owner", "Rekan pemilik"], ["manager", "Manajer"],
                  ["hr_recruitment", "Staf HR / rekrutmen"], ["other", "Lainnya"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessRoleOther" placeholder="Sebutkan peran">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>B. Karakteristik usaha</h3>
            <fieldset class="compact-fieldset">
              <legend>B1. Sektor utama usaha</legend>
              <div class="compact-options">
                ${radioOptions("businessSector", [
                  ["manufacturing", "Manufaktur"],
                  ["accommodation_food", "Akomodasi dan penyediaan makanan/minuman"],
                  ["wholesale_retail", "Perdagangan besar dan eceran"],
                  ["personal_services", "Jasa personal lainnya (jasa kecantikan)"],
                  ["other", "Sektor lainnya"],
                ])}
              </div>
              <input class="conditional-other hidden" name="businessSectorOther" placeholder="Sebutkan sektor">
            </fieldset>
            <div class="compact-pair">
              <label><strong>B2. Tahun usaha berdiri</strong>
                <input class="year-input" name="establishedYear" type="number" min="1900" max="${currentYear}" step="1" inputmode="numeric" required>
              </label>
              <fieldset class="compact-fieldset">
                <legend>B3. Jumlah pekerja</legend>
                <div class="compact-options two-up">
                  ${radioOptions("workers", [["1_4", "1-4"], ["5_19", "5-19"], ["20_99", "20-99"], ["100_plus", "100 atau lebih"]])}
                </div>
              </fieldset>
            </div>
            <fieldset class="compact-fieldset">
              <legend>B4. Perkiraan omzet tahunan</legend>
              <div class="compact-options">
                ${radioOptions("annualRevenue", [
                  ["less_300m", "Kurang dari IDR 300 juta"],
                  ["300m_to_2_5b", "IDR 300 juta sampai kurang dari IDR 2,5 miliar"],
                  ["2_5b_to_50b", "IDR 2,5 miliar sampai kurang dari IDR 50 miliar"],
                  ["50b_plus", "IDR 50 miliar atau lebih"],
                  ["prefer_not_to_say", "Memilih untuk tidak menjawab"],
                ])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>B5. Lokasi usaha</legend>
              <div class="inline-inputs">
                <label>Kota<input name="city" required></label>
                <label>Provinsi<input name="province" required></label>
              </div>
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>C. Aktivitas terkait digital</h3>
            <fieldset class="compact-fieldset">
              <legend>C2. Penggunaan media sosial untuk usaha saat ini</legend>
              <p class="compact-prompt">Apakah usaha Anda saat ini memiliki akun media sosial aktif untuk pemasaran atau penjualan?</p>
              <div class="compact-options two-up">
                ${radioOptions("activeSocialMedia", [["yes", "Ya"], ["no", "Tidak"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset platforms-fieldset">
              <legend>C3. Platform yang saat ini digunakan</legend>
              <p class="compact-prompt">Pilih semua yang sesuai.</p>
              <div class="compact-options two-up platform-options">
                ${[
                  ["instagram", "Instagram"], ["tiktok", "TikTok"], ["facebook", "Facebook"],
                  ["whatsapp_business", "WhatsApp Business"], ["youtube", "YouTube"],
                  ["x_twitter", "X / Twitter"], ["other", "Lainnya"],
                ].map(([value, label]) => `
                  <label class="compact-option">
                    <input type="checkbox" name="platforms" value="${value}">
                    <span>${label}</span>
                  </label>
                `).join("")}
              </div>
              <input class="conditional-other hidden" name="platformOther" placeholder="Sebutkan platform">
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C4. Pengalaman rekrutmen sebelumnya</legend>
              <p class="compact-prompt">Apakah usaha Anda pernah merekrut seseorang secara khusus untuk mengelola media sosial, konten, atau promosi digital?</p>
              <div class="compact-options two-up">
                ${radioOptions("previousDigitalHiring", [["yes", "Ya"], ["no", "Tidak"]])}
              </div>
            </fieldset>
            <fieldset class="compact-fieldset">
              <legend>C5. Bentuk kerja terbaru</legend>
              <p class="compact-prompt">Bentuk kerja apa yang terakhir digunakan, atau yang Anda rencanakan untuk rekrutmen berikutnya?</p>
              <div class="compact-options">
                ${radioOptions("workArrangement", [
                  ["full_time", "Karyawan penuh waktu"], ["part_time", "Karyawan paruh waktu"],
                  ["freelancer", "Freelancer / pekerja berbasis proyek"],
                  ["family_informal", "Anggota keluarga / bantuan informal"], ["other", "Lainnya"],
                ])}
              </div>
              <input class="conditional-other hidden" name="workArrangementOther" placeholder="Sebutkan bentuk kerja">
            </fieldset>
          </section>

          <section class="characteristics-section">
            <h3>D. Motivasi partisipasi</h3>
            <fieldset class="compact-fieldset">
              <legend>D1. Pentingnya manfaat pencocokan kandidat</legend>
              <p class="compact-prompt">Seberapa penting kemungkinan dicocokkan dengan kandidat potensial dalam memotivasi Anda untuk mengikuti sesi ini?</p>
              <div class="importance-scale">
                ${radioOptions("matchingBenefitImportance", [["1", "1 Tidak penting"], ["2", "2 Sedikit penting"], ["3", "3 Cukup penting"], ["4", "4 Penting"], ["5", "5 Sangat penting"]])}
              </div>
            </fieldset>
          </section>
        </div>
        <div class="nav-actions">
          <button class="secondary previous-characteristics" type="button">Sebelumnya</button>
          <button type="submit">Simpan dan lanjutkan</button>
        </div>
      </form>
    </article>
  `;

  const form = respondent.querySelector("#characteristics-form");
  populateCharacteristicsForm(form, state.session.characteristics);
  attachCharacteristicsConditions(form);
  attachYearInputDefaults(form);
  form.querySelector(".previous-characteristics").addEventListener("click", previousStep);
  form.addEventListener("submit", submitEmployerCharacteristics);
}

function attachYearInputDefaults(form) {
  form.querySelectorAll(".year-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (!input.value && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        input.value = "2010";
      }
    });

    input.addEventListener("pointerdown", (event) => {
      const clickedStepper = event.offsetX >= input.clientWidth - 28;
      if (!input.value && clickedStepper) {
        input.value = "2010";
      }
    });
  });
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
    alert("Mohon pilih setidaknya satu platform media sosial yang saat ini digunakan.");
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

function renderProductivityDefinition(variant) {
  const isReveal = variant === "hidden_reveal";
  const title = "Informasi Kinerja Kandidat";
  const transition = isReveal
    ? `
      <p>Terima kasih. Anda telah menyelesaikan penilaian pertama untuk semua profil kandidat.</p>
      <p>
        Pada bagian berikutnya, Anda akan menilai kembali profil kandidat yang sama. Kali ini, setiap
        profil akan memuat informasi dari tes kinerja kandidat. Seperti sebelumnya, mohon jawab
        pertanyaan lanjutan berdasarkan penilaian Anda yang sebenarnya.
      </p>
    `
    : "";

  respondent.innerHTML = `
    <article class="text-page productivity-info-page">
      <h2>${title}</h2>
      <div class="productivity-info-copy">
        ${transition}
        <section class="information-copy-section">
          <h3>Pengantar</h3>
          <p>
            Kami memahami bahwa menilai seberapa baik seorang kandidat akan bekerja dalam posisi ini
            hanya berdasarkan profil dapat menjadi hal yang sulit. Oleh karena itu, semua kandidat
            mengikuti tes kinerja media sosial yang terstandar.
          </p>
        </section>
        <section class="information-copy-section">
          <h3>Bagaimana Kinerja Kandidat Dinilai</h3>
          <ul>
            <li>
              Tes dilakukan selama tiga minggu dalam <strong>format kompetisi</strong>. Semua kandidat
              mengikuti tes dengan kondisi umum yang sama dan menerima kompensasi partisipasi yang sama.
            </li>
            <li><strong>Tiga peserta dengan kinerja terbaik menerima hadiah tambahan</strong>.</li>
            <li>
              Kandidat bebas menggunakan perangkat lunak atau alat AI apa pun untuk membuat konten.
              Namun, mereka tidak diperbolehkan membeli pengikut atau membuat interaksi palsu.
            </li>
          </ul>
        </section>
        <section class="information-copy-section">
          <h3>Indikator Kinerja</h3>
          <p>Kami menggunakan dua indikator untuk menilai kinerja kandidat: <strong>Jangkauan (<i>reach</i>)</strong> dan <strong>Interaksi</strong>.</p>
          <p>
            <strong>Indikator Jangkauan (<i>reach</i>):</strong> menunjukkan seberapa luas konten kandidat
            menjangkau audiens. Indikator ini diukur sebagai rata-rata jumlah
            <strong>akun unik yang dijangkau per postingan</strong> selama periode evaluasi. Ini berbeda
            dari jumlah tayangan: satu akun dapat melihat satu postingan lebih dari sekali, tetapi
            hanya dihitung satu kali dalam ukuran jangkauan.
          </p>
          <p>
            <strong>Indikator Interaksi:</strong> menunjukkan bagaimana audiens merespons konten
            kandidat. Indikator ini diukur sebagai rata-rata jumlah interaksi per postingan selama
            periode evaluasi. Interaksi mencakup likes atau reaksi, komentar, repost, share, dan save.
          </p>
        </section>
        <p>
          Pada bagian berikutnya, profil kandidat akan memuat informasi dari tes ini untuk merangkum
          kinerja setiap kandidat dalam mengelola konten media sosial dan menarik respons audiens.
        </p>
      </div>
      <section class="metric-examples" aria-label="Contoh indikator kinerja">
        <h3>Ilustrasi Indikator Kinerja</h3>
        <article class="metric-example">
          <h4>Ilustrasi Indikator Jangkauan (<i>reach</i>)</h4>
          <img src="/assets/reach-example.jpg" alt="Contoh insight platform yang menunjukkan akun dijangkau">
        </article>
        <article class="metric-example">
          <h4>Ilustrasi Indikator Interaksi</h4>
          <img src="/assets/interaction-example.jpg" alt="Contoh insight platform yang menunjukkan likes, komentar, repost, share, dan save">
        </article>
      </section>
      <p class="muted">
        Tangkapan layar ini hanya contoh. Nilai khusus untuk setiap kandidat akan ditampilkan pada
        masing-masing profil kandidat.
      </p>
      ${navigationButtons("Lanjut")}
    </article>
  `;
  attachNavigation(respondent);
}

function renderGuideScale(label, position, calloutText = "", benchmark = {}) {
  const markerClass = performanceMarkerClass(position);
  const { min = "", median = "", max = "" } = benchmark;
  return `
    <div class="guide-metric">
      <p><strong>${label}</strong></p>
      <div class="guide-track${calloutText ? " guide-track-with-callout" : ""}">
        ${calloutText ? `<span class="marker-callout" style="--guide-position: ${position}%">${calloutText} <span aria-hidden="true">&darr;</span></span>` : ""}
        <span class="scale-tick scale-min"></span>
        <span class="scale-tick scale-median"></span>
        <span class="scale-tick scale-max"></span>
        <span class="guide-marker ${markerClass}" style="--guide-position: ${position}%"></span>
      </div>
      <div class="guide-scale-labels">
        <span><span>Minimum</span><strong>${min}</strong></span>
        <span><span>Median</span><strong>${median}</strong></span>
        <span><span>Maksimum</span><strong>${max}</strong></span>
      </div>
    </div>
  `;
}

function renderProductivityReadingGuide() {
  respondent.innerHTML = `
    <article class="text-page performance-reading-page">
      <h2>Cara Membaca Informasi Kinerja Kandidat</h2>
      <section class="performance-reading-key">
        <div class="key-copy">
          <p>
            Titik menunjukkan posisi kandidat untuk setiap indikator. Garis bergerak dari kinerja
            <strong class="scale-value-low">terendah</strong> yang diamati dalam kumpulan talenta hingga
            kinerja <strong class="scale-value-high">tertinggi</strong> yang diamati, dengan median di
            <strong>tengah</strong>.
          </p>
          <div class="benchmark-summary">
            <strong>Benchmark kumpulan talenta</strong>
            <span>Jangkauan (<i>reach</i>): minimum <strong class="scale-value-low">100</strong>, median <strong class="scale-value-median">500</strong>, maksimum <strong class="scale-value-high">2.500</strong> akun dijangkau per postingan.</span>
            <span>Interaksi: minimum <strong class="scale-value-low">3</strong>, median <strong class="scale-value-median">25</strong>, maksimum <strong class="scale-value-high">150</strong> interaksi per postingan.</span>
          </div>
          <ul class="reading-key-points">
            <li>Benchmark dihitung dari hasil tes terstandar seluruh kandidat.</li>
            <li>Median berarti separuh kandidat memiliki nilai di bawahnya dan separuh kandidat memiliki nilai di atasnya.</li>
            <li>Angka mentah menunjukkan rata-rata aktual per postingan; garis menunjukkan posisi relatif kandidat.</li>
          </ul>
        </div>
        <div class="key-scale performance-guide-example" aria-label="Contoh kinerja kandidat">
          <h3>Contoh: Jangkauan Lebih Rendah, Interaksi Lebih Kuat</h3>
          ${renderGuideScale("Indikator Jangkauan (<i>reach</i>)", 25, "Posisi Jangkauan Kandidat", { min: "100", median: "500", max: "2.500" })}
          ${renderGuideScale("Indikator Interaksi", 75, "Posisi Interaksi Kandidat", { min: "3", median: "25", max: "150" })}
          <p>
            Dalam contoh ini, jangkauan kandidat berada di bawah median, sedangkan interaksinya
            berada di atas median dibandingkan dengan kumpulan talenta.
          </p>
        </div>
      </section>
      ${navigationButtons("Lanjut")}
    </article>
  `;
  attachNavigation(respondent);
}

function renderIneligibleEnd() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Akhir Sesi</h2>
      <p>
        Terima kasih atas waktu Anda. Berdasarkan jawaban kelayakan, sesi ini tidak akan dilanjutkan
        ke halaman penilaian kandidat.
      </p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Sebelumnya</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", renderStep);
  addEnumeratorDashboardButton();
}

function renderComplete() {
  respondent.innerHTML = `
    <article class="text-page">
      <h2>Sesi Selesai</h2>
      <p>Terima kasih atas waktu dan jawaban Anda yang cermat. Sesi Anda telah selesai.</p>
      <p>Kami sangat menghargai perhatian Anda dalam menilai profil kandidat.</p>
      <div class="nav-actions">
        <button class="secondary previous-screen" type="button">Sebelumnya</button>
      </div>
    </article>
  `;
  respondent.querySelector(".previous-screen").addEventListener("click", previousStep);
}

function renderCandidate(step) {
  const template = document.querySelector("#candidate-template");
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".candidate-card");
  const candidate = candidateById(step.candidate_id);
  const response = existingResponsesMap().get(responseKey(candidate.id, step.stage));
  const draft = response ? null : existingDraftsMap().get(responseKey(candidate.id, step.stage));
  const savedResponse = response || draft;

  card.querySelector(".eyebrow").textContent = `Profil ${candidate.code}`;
  card.querySelector("h2").textContent = candidate.pseudonym;

  const grid = card.querySelector(".candidate-grid");
  const appendField = (container, key, value, className = "field") => {
    const field = document.createElement("div");
    field.className = className;
    field.innerHTML = `<strong>${labelize(key)}</strong><span>${value}</span>`;
    container.append(field);
  };
  const identity = document.createElement("section");
  identity.className = "candidate-identity";
  const avatar = document.createElement("img");
  const gender = String(candidate.baseline.gender || "").toLowerCase();
  const isFemale = gender === "female" || gender === "perempuan";
  avatar.className = "candidate-avatar";
  avatar.src = isFemale ? "/assets/default-female-avatar.png" : "/assets/default-male-avatar.png";
  avatar.alt = isFemale ? "Avatar profil perempuan" : "Avatar profil laki-laki";
  const basicInformation = document.createElement("div");
  basicInformation.className = "candidate-basic-information";
  ["gender", "age"].forEach((key) => {
    if (candidate.baseline[key]) appendField(basicInformation, key, candidate.baseline[key]);
  });
  identity.append(avatar, basicInformation);
  grid.append(identity);
  const education = document.createElement("section");
  education.className = "education-summary";
  education.innerHTML = `
    <div><strong>Tingkat Pendidikan</strong><span>${candidate.baseline.education_level || "Belum diisi"}</span></div>
    <div><strong>Jurusan Pendidikan</strong><span>${candidate.baseline.education_major || "Belum diisi"}</span></div>
  `;
  basicInformation.append(education);
  if (candidate.baseline.relevant_experience) {
    appendField(grid, "relevant_experience", candidate.baseline.relevant_experience, "supporting-summary");
  }
  if (candidate.baseline.skills) {
    appendField(grid, "relevant_skills", candidate.baseline.skills, "supporting-summary");
  }

  const informationBlock = card.querySelector(".productivity-block");
  const showsProductivity = Boolean(step.show_productivity);
  const showsAdditionalInformation = Boolean(step.show_additional_information);
  if (showsProductivity) {
    informationBlock.innerHTML = `<h3>Informasi Kinerja Kandidat</h3>`;
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
  }
  if (showsAdditionalInformation) {
    const additionalInformation = document.createElement("section");
    additionalInformation.className = "additional-information-subsection";
    additionalInformation.innerHTML = "<h3>Informasi Tambahan</h3>";
    Object.entries(candidate.placebo).forEach(([key, value]) => {
      const field = document.createElement("p");
      field.innerHTML = `<strong>${labelize(key)}:</strong> ${value}`;
      additionalInformation.append(field);
    });
    if (showsProductivity) {
      informationBlock.append(additionalInformation);
    } else {
      informationBlock.classList.add("placeholder");
      informationBlock.innerHTML = "";
      informationBlock.append(additionalInformation);
    }
  }
  if (!showsProductivity && !showsAdditionalInformation) {
    informationBlock.remove();
  }

  const form = card.querySelector(".response-form");
  form.dataset.showProductivity = String(showsProductivity);
  form.dataset.showAdditionalInformation = String(showsAdditionalInformation);
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
  form.querySelector(".save-candidate-draft").addEventListener("click", () => saveCandidateDraft(form, step, candidate));
  form.querySelector(".previous-step").addEventListener("click", previousStep);
  form.addEventListener("submit", (event) => submitCandidateResponse(event, step, candidate));

  if (savedResponse) {
    form.dataset.wageConfirmed = "true";
    const values = response ? {
      wageValue: response.wage_value,
      hireInterest: response.hire_interest,
      conditionalWageOffer: response.conditional_wage_offer,
    } : savedResponse;
    if (values.wageValue !== null && values.wageValue !== undefined) {
      form.elements.wageValue.value = values.wageValue;
    }
    if (values.hireInterest) {
      form.elements.hireInterest.value = values.hireInterest;
      form.dataset.reasonsConfirmed = "true";
    }
    if (values.conditionalWageOffer !== null && values.conditionalWageOffer !== undefined) {
      form.elements.conditionalWageOffer.value = values.conditionalWageOffer;
      form.dataset.offerConfirmed = "true";
    }
  }

  renderReasons(form, reasonOptions, rankedReasons, response, draft);
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

  const hasRatedReason = [...form.querySelectorAll('input[type="range"][name^="score-"]')]
    .some((input) => Number(input.value) > 0);
  if (!hasRatedReason) {
    form.dataset.offerConfirmed = "";
  }
  form.querySelector(".reasons-done").disabled = !(reasonsVisible && hasRatedReason);

  const reasonsConfirmed = revealAll || form.dataset.reasonsConfirmed === "true";
  const offerVisible = reasonsVisible && hasRatedReason && reasonsConfirmed;
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
  const hasRatedReason = [...form.querySelectorAll('input[type="range"][name^="score-"]')]
    .some((input) => Number(input.value) > 0);
  if (!hasRatedReason) {
    alert("Mohon beri nilai kepentingan di atas nol untuk setidaknya satu alasan sebelum melanjutkan.");
    return;
  }
  const otherReasonInput = form.querySelector(".other-reason-input:not(:disabled)");
  if (otherReasonInput && !otherReasonInput.value.trim()) {
    alert("Mohon sebutkan alasan lainnya sebelum melanjutkan.");
    otherReasonInput.focus();
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

function renderReasons(form, reasonOptions, rankedReasons, response, draft = null) {
  const hireInterest = form.elements.hireInterest.value;
  const reasonsLegend = form.querySelector(".reasons-legend");
  reasonOptions.innerHTML = "";
  rankedReasons.innerHTML = "";
  if (!hireInterest) {
    reasonsLegend.textContent = "Alasan merekrut / tidak merekrut";
    reasonOptions.innerHTML = "<p class=\"muted\">Pilih minat untuk merekrut terlebih dahulu.</p>";
    return;
  }

  reasonsLegend.textContent = hireInterest === "yes" ? "Alasan merekrut" : "Alasan tidak merekrut";

  const canUseCompletedReasons = response && response.hire_interest === hireInterest;
  const canUseDraftReasons = draft && draft.hireInterest === hireInterest;
  const ranked = canUseCompletedReasons ? JSON.parse(response.ranked_reasons_json) : [];
  const savedScores = canUseCompletedReasons && response.reason_scores_json
    ? JSON.parse(response.reason_scores_json)
    : (canUseDraftReasons ? draft.reasonScores || {} : {});
  const savedOtherReasonText = canUseCompletedReasons
    ? response.other_reason_text || ""
    : (canUseDraftReasons ? draft.otherReasonText || "" : "");
  const visibleConditionalLabels = new Set();
  if (form.dataset.showProductivity === "true") {
    visibleConditionalLabels.add(CONDITIONAL_REASON_LABELS.productivity[hireInterest]);
  }
  if (form.dataset.showAdditionalInformation === "true") {
    visibleConditionalLabels.add(CONDITIONAL_REASON_LABELS.placebo[hireInterest]);
  }
  const reasons = state.session.reasons.filter((reason) => {
    if (reason.applies_to !== hireInterest) {
      return false;
    }
    if (!CONDITIONAL_REASON_LABEL_SET.has(reason.label)) {
      return true;
    }
    return visibleConditionalLabels.has(reason.label);
  });

  reasons.forEach((reason) => {
    const line = document.createElement("label");
    line.className = "reason-line";
    const isOtherReason = reason.label === OTHER_REASON_LABEL;
    line.innerHTML = `
      <span>${renderReasonLabel(reason.label)}</span>
      <span class="reason-rating">
        <input type="range" name="score-${reason.id}" min="0" max="100" step="1" value="0">
        <output>0</output>
      </span>
      ${isOtherReason ? `<input class="other-reason-input hidden" name="otherReasonText" maxlength="300" disabled placeholder="Sebutkan">` : ""}
    `;
    const score = line.querySelector(`input[name="score-${reason.id}"]`);
    const output = line.querySelector("output");
    const savedScore = savedScores[String(reason.id)];
    const legacyRankIndex = ranked.indexOf(reason.id);
    if (savedScore !== undefined) {
      score.value = savedScore;
    } else if (legacyRankIndex >= 0) {
      score.value = Math.max(0, 100 - legacyRankIndex * 25);
    }
    output.textContent = score.value;
    const otherReasonInput = line.querySelector(".other-reason-input");
    if (otherReasonInput) {
      otherReasonInput.value = savedOtherReasonText;
      const updateOtherReasonInput = () => {
        const enabled = Number(score.value) > 0;
        otherReasonInput.disabled = !enabled;
        otherReasonInput.required = enabled;
        otherReasonInput.classList.toggle("hidden", !enabled);
      };
      updateOtherReasonInput();
      otherReasonInput.addEventListener("input", () => {
        form.dataset.reasonsConfirmed = "";
        form.dataset.offerConfirmed = "";
        updateCandidateProgression(form);
      });
      score.addEventListener("input", updateOtherReasonInput);
    }
    score.addEventListener("input", () => {
      output.textContent = score.value;
      form.dataset.reasonsConfirmed = "";
      form.dataset.offerConfirmed = "";
      updateCandidateProgression(form);
    });
    reasonOptions.append(line);
  });
}

function renderReasonLabel(label) {
  if (label.startsWith("Informasi Tambahan")) {
    const reference = "Informasi Tambahan";
    return `<strong class="reason-information-reference placebo-reference">${reference}</strong>${label.slice(reference.length)}`;
  }
  if (label.startsWith("Kinerja tugas")) {
    const reference = "Kinerja tugas";
    return `<strong class="reason-information-reference productivity-reference">${reference}</strong>${label.slice(reference.length)}`;
  }
  return label;
}

function collectReasonScores(form) {
  const reasonScores = {};
  form.querySelectorAll('input[type="range"][name^="score-"]').forEach((input) => {
    const reasonId = Number(input.name.replace("score-", ""));
    reasonScores[reasonId] = Number(input.value);
  });
  return reasonScores;
}

async function saveCandidateDraft(form, step, candidate) {
  const status = form.querySelector(".draft-status");
  const button = form.querySelector(".save-candidate-draft");
  button.disabled = true;
  status.textContent = "Menyimpan...";
  try {
    await api(`/api/session/${state.session.session.id}/response/draft`, {
      method: "POST",
      body: JSON.stringify({
        candidateId: candidate.id,
        stage: step.stage,
        wageValue: moneyToInteger(form.elements.wageValue.value),
        hireInterest: form.elements.hireInterest.value || null,
        reasonScores: collectReasonScores(form),
        otherReasonText: form.elements.otherReasonText?.value || "",
        conditionalWageOffer: moneyToInteger(form.elements.conditionalWageOffer.value),
      }),
    });
    state.session = await api(`/api/session/${state.session.session.id}`);
    status.textContent = "Sementara tersimpan";
  } catch (error) {
    status.textContent = error.message || "Tidak dapat menyimpan sementara";
  } finally {
    button.disabled = false;
  }
}

async function submitCandidateResponse(event, step, candidate) {
  event.preventDefault();
  const form = event.currentTarget;
  const wageValue = moneyToInteger(form.elements.wageValue.value);
  const conditionalWageOffer = moneyToInteger(form.elements.conditionalWageOffer.value);
  if (!Number.isSafeInteger(wageValue) || !Number.isSafeInteger(conditionalWageOffer)) {
    alert("Mohon masukkan kedua nilai gaji hanya dalam angka bulat.");
    return;
  }
  const reasonScores = collectReasonScores(form);
  const selectedReasons = Object.keys(reasonScores).map(Number);
  const rankedReasons = selectedReasons
    .map((reasonId) => ({
      reasonId,
      score: reasonScores[reasonId],
    }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.reasonId);

  if (!selectedReasons.some((reasonId) => reasonScores[reasonId] > 0)) {
    alert("Mohon beri nilai kepentingan di atas nol untuk setidaknya satu alasan.");
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
      otherReasonText: form.elements.otherReasonText?.value || "",
      conditionalWageOffer,
      showProductivity: form.dataset.showProductivity === "true",
      showAdditionalInformation: form.dataset.showAdditionalInformation === "true",
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
    gender: "Jenis Kelamin",
    age: "Usia",
    education_level: "Tingkat Pendidikan",
    education_major: "Jurusan Pendidikan",
    relevant_experience: "Pengalaman Relevan",
    relevant_skills: "Keahlian Relevan",
    additional_information: "informasi tambahan",
    reach_indicator: "Indikator Jangkauan (<i>reach</i>)",
    interaction_indicator: "Indikator Interaksi",
    benchmark: "Benchmark kumpulan talenta",
  };
  if (labels[key]) {
    return labels[key];
  }
  return key.replaceAll("_", " ");
}

function formatNumber(value) {
  return Number(value).toLocaleString("id-ID");
}

function parseMetricValue(text) {
  const match = String(text).match(/:\s*([\d,.]+)/);
  return match ? Number(match[1].replace(/\D/g, "")) : null;
}

function formatCandidateMetric(key, textValue, candidateName) {
  const value = parseMetricValue(textValue);
  const formattedValue = Number.isFinite(value) ? formatNumber(value) : textValue;
  if (key === "reach_indicator") {
    return `Rata-rata akun yang dijangkau per postingan oleh ${candidateName}: ${formattedValue}`;
  }
  if (key === "interaction_indicator") {
    return `Rata-rata interaksi per postingan oleh ${candidateName}: ${formattedValue}`;
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

function performanceMarkerClass(position) {
  if (position <= 0) return "marker-low";
  if (position < 50) return "marker-low-mid";
  if (position === 50) return "marker-median";
  if (position < 100) return "marker-high-mid";
  return "marker-high";
}

function renderBenchmarkScale(key, textValue, candidateName) {
  const range = BENCHMARK_RANGES[key];
  if (!range) {
    return "";
  }
  const candidateValue = parseMetricValue(textValue);
  const markerPosition = benchmarkPosition(candidateValue, range);
  const markerClass = performanceMarkerClass(markerPosition);
  const candidateLabel = Number.isFinite(candidateValue)
    ? `<p class="scale-caption">Kinerja ${candidateName}: ${formatNumber(candidateValue)} ${range.unit}</p>`
    : "";
  return `
    <div class="benchmark-scale" style="--candidate-position: ${markerPosition}%">
      <div class="scale-track" aria-hidden="true">
        <span class="scale-tick scale-min"></span>
        <span class="scale-tick scale-median"></span>
        <span class="scale-tick scale-max"></span>
        ${Number.isFinite(candidateValue) ? `<span class="candidate-marker ${markerClass}"></span>` : ""}
      </div>
      <div class="scale-labels">
        <span>Min ${formatNumber(range.min)}</span>
        <span>Median ${formatNumber(range.median)}</span>
        <span>Maks ${formatNumber(range.max)}</span>
      </div>
      ${candidateLabel}
    </div>
  `;
}

async function createSessionFromForm(form, statusElement) {
  const submitButton = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.randomizationSeed) {
    delete data.randomizationSeed;
  }
  submitButton.disabled = true;
  statusElement.textContent = "Membuat sesi...";
  try {
    return await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    statusElement.textContent = error.message || "Tidak dapat membuat sesi.";
    return null;
  } finally {
    submitButton.disabled = false;
  }
}

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const created = await createSessionFromForm(form, sessionCreateStatus);
  if (!created) {
    return;
  }
  form.reset();
  await loadBootstrap();
  await loadSessions();
  sessionCreateStatus.textContent = `Sesi ${created.sessionCode} telah dibuat.`;
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
    enumeratorLoginStatus.textContent = "Passcode salah.";
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
    candidateImportStatus.textContent = "Pilih file CSV terlebih dahulu.";
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
    candidateImportStatus.textContent = result.error || "Impor gagal.";
    return;
  }
  candidateImportStatus.textContent = `${result.imported} baris kandidat berhasil diimpor.`;
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
    document.body.innerHTML = `<main><section class="panel"><h2>Kesalahan saat memulai</h2><p>${error.message}</p></section></main>`;
  });
