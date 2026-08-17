// ============================================================
// Watchega — app logic
// ============================================================

const { createClient } = supabase;
const sb = createClient(window.WATCHEGA_CONFIG.SUPABASE_URL, window.WATCHEGA_CONFIG.SUPABASE_ANON_KEY);

const STATUS_ORDER = [
  'Student working on it',
  'Mentor working on it',
  'Submission Ready by Student',
  'Submitted'
];
const STATUS_COLOR = {
  'Student working on it': 'var(--status-student)',
  'Mentor working on it': 'var(--status-mentor)',
  'Submission Ready by Student': 'var(--status-ready)',
  'Submitted': 'var(--status-submitted)'
};

let state = {
  session: null,
  profile: null,       // { id, email, role }
  competitions: [],
  sortKey: 'deadline',
  sortDir: 'asc',
  search: '',
  editingId: null       // null = adding new
};

// ---------- helpers ----------
function $(id) { return document.getElementById(id); }

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function authedFetch(path, body) {
  const token = state.session?.access_token;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  if (session) {
    boot();
  } else {
    $('app').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
  }
});

$('login-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  $('login-error').textContent = '';
  if (!email || !password) {
    $('login-error').textContent = 'Enter both email and password.';
    return;
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) $('login-error').textContent = error.message;
});

$('signout-btn').addEventListener('click', () => sb.auth.signOut());

async function boot() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  const { data: { user } } = await sb.auth.getUser();
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error) {
    toast('Could not load your profile: ' + error.message, true);
    return;
  }
  state.profile = profile;

  $('who-email').textContent = profile.email;
  $('who-role').textContent = profile.role;
  $('manage-users-btn').classList.toggle('hidden', profile.role !== 'owner');
  $('add-competition-btn').classList.toggle('hidden', profile.role !== 'owner');

  await loadCompetitions();
}

// ---------- competitions: load / render ----------
async function loadCompetitions() {
  const { data, error } = await sb.from('competitions').select('*');
  if (error) {
    toast('Could not load competitions: ' + error.message, true);
    return;
  }
  state.competitions = data;
  render();
}

function getFilteredSorted() {
  const q = state.search.trim().toLowerCase();
  let rows = state.competitions.filter(c => {
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) ||
           (c.description || '').toLowerCase().includes(q) ||
           (c.status || '').toLowerCase().includes(q) ||
           (c.result || '').toLowerCase().includes(q);
  });
  const { sortKey, sortDir } = state;
  rows = rows.slice().sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'status') { av = STATUS_ORDER.indexOf(av); bv = STATUS_ORDER.indexOf(bv); }
    if (av === null || av === undefined) av = '';
    if (bv === null || bv === undefined) bv = '';
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return rows;
}

function stageTrackerHTML(status) {
  const idx = STATUS_ORDER.indexOf(status);
  const color = STATUS_COLOR[status] || 'var(--text-dim)';
  const segs = STATUS_ORDER.map((_, i) =>
    `<div class="seg ${i <= idx ? 'filled' : ''}" style="--stage-color:${color}"></div>`
  ).join('');
  return `<div class="stage-tracker">${segs}</div><div class="stage-label" style="--stage-color:${color}">${status}</div>`;
}

function render() {
  const rows = getFilteredSorted();
  $('results-count').textContent = `Competitions (${rows.length})`;
  const tbody = $('table-body');
  tbody.innerHTML = '';
  $('empty-state').classList.toggle('hidden', rows.length !== 0);

  for (const c of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name-cell" data-label="Name">${escapeHTML(c.name)}${c.description ? `<span class="desc">${escapeHTML(c.description)}</span>` : ''}</td>
      <td data-label="Status">${stageTrackerHTML(c.status)}</td>
      <td class="date-cell" data-label="Registration opens">${fmtDate(c.registration_opens)}</td>
      <td class="date-cell deadline-cell" data-label="Deadline">${fmtDate(c.deadline)}</td>
      <td class="date-cell last-update-cell" data-label="Last update">${fmtDate(c.last_status_update)}</td>
      <td data-label="Result">${c.result ? escapeHTML(c.result) : '<span style="color:var(--text-dim)">—</span>'}</td>
    `;
    tr.addEventListener('click', () => openCompetitionModal(c.id));
    tbody.appendChild(tr);
  }
}

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// ---------- sorting ----------
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = 'asc';
    }
    document.querySelectorAll('th[data-sort] .arrow').forEach(a => a.textContent = '');
    th.querySelector('.arrow').textContent = state.sortDir === 'asc' ? '↑' : '↓';
    render();
  });
});

// ---------- search ----------
$('search-input').addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});

// ---------- competition modal ----------
const isOwner = () => state.profile?.role === 'owner';

function fillForm(c) {
  $('f-name').value = c?.name || '';
  $('f-description').value = c?.description || '';
  $('f-url').value = c?.url || '';
  $('f-reg-opens').value = c?.registration_opens || '';
  $('f-deadline').value = c?.deadline || '';
  $('f-status').value = c?.status || STATUS_ORDER[0];
  $('f-result').value = c?.result || '';
}

function setFormDisabled(disabled) {
  ['f-name','f-description','f-url','f-reg-opens','f-deadline','f-status','f-result']
    .forEach(id => $(id).disabled = disabled);
  $('save-competition-btn').classList.toggle('hidden', disabled);
}

async function openCompetitionModal(id) {
  state.editingId = id || null;
  const c = id ? state.competitions.find(x => x.id === id) : null;

  $('modal-title').textContent = id ? 'Competition details' : 'Add competition';
  $('modal-error').textContent = '';
  fillForm(c);
  setFormDisabled(!isOwner());
  $('delete-competition-btn').classList.toggle('hidden', !(id && isOwner()));
  $('doc-section').classList.toggle('hidden', !id);

  $('competition-modal').classList.remove('hidden');

  if (id) await loadDocuments(id);
}

function closeCompetitionModal() {
  $('competition-modal').classList.add('hidden');
  state.editingId = null;
}
$('modal-close-btn').addEventListener('click', closeCompetitionModal);
$('cancel-competition-btn').addEventListener('click', closeCompetitionModal);
$('add-competition-btn').addEventListener('click', () => openCompetitionModal(null));

$('save-competition-btn').addEventListener('click', async () => {
  const payload = {
    name: $('f-name').value.trim(),
    description: $('f-description').value.trim() || null,
    url: $('f-url').value.trim() || null,
    registration_opens: $('f-reg-opens').value || null,
    deadline: $('f-deadline').value || null,
    status: $('f-status').value,
    result: $('f-result').value.trim() || null
  };
  if (!payload.name) {
    $('modal-error').textContent = 'Name is required.';
    return;
  }

  if (state.editingId) {
    const { error } = await sb.from('competitions').update(payload).eq('id', state.editingId);
    if (error) { $('modal-error').textContent = error.message; return; }
    toast('Competition updated.');
  } else {
    payload.created_by = state.session.user.id;
    const { error } = await sb.from('competitions').insert(payload);
    if (error) { $('modal-error').textContent = error.message; return; }
    toast('Competition added.');
  }
  closeCompetitionModal();
  await loadCompetitions();
});

$('delete-competition-btn').addEventListener('click', async () => {
  if (!state.editingId) return;
  if (!confirm('Delete this competition and all its documents? This cannot be undone.')) return;
  const { error } = await sb.from('competitions').delete().eq('id', state.editingId);
  if (error) { toast('Delete failed: ' + error.message, true); return; }
  toast('Competition deleted.');
  closeCompetitionModal();
  await loadCompetitions();
});

// ---------- documents ----------
async function loadDocuments(competitionId) {
  const { data, error } = await sb.from('documents').select('*').eq('competition_id', competitionId).order('uploaded_at', { ascending: false });
  const list = $('doc-list');
  list.innerHTML = '';
  if (error) { toast('Could not load documents: ' + error.message, true); return; }
  $('doc-empty').classList.toggle('hidden', data.length !== 0);
  for (const doc of data) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHTML(doc.file_name)}</span>
      <span class="doc-actions">
        <button data-action="download">Download</button>
        <button data-action="delete" class="danger">Delete</button>
      </span>
    `;
    li.querySelector('[data-action="download"]').addEventListener('click', () => downloadDocument(doc));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteDocument(doc));
    list.appendChild(li);
  }
}

$('doc-upload-btn').addEventListener('click', async () => {
  const input = $('doc-file-input');
  const file = input.files[0];
  if (!file) { toast('Choose a file first.', true); return; }
  if (!state.editingId) { toast('Save the competition before adding documents.', true); return; }

  const path = `${state.editingId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await sb.storage.from('documents').upload(path, file);
  if (upErr) { toast('Upload failed: ' + upErr.message, true); return; }

  const { error: insErr } = await sb.from('documents').insert({
    competition_id: state.editingId,
    file_name: file.name,
    storage_path: path,
    uploaded_by: state.session.user.id
  });
  if (insErr) { toast('Upload saved but record failed: ' + insErr.message, true); return; }

  input.value = '';
  toast('Document uploaded.');
  await loadDocuments(state.editingId);
});

async function downloadDocument(doc) {
  const { data, error } = await sb.storage.from('documents').createSignedUrl(doc.storage_path, 60);
  if (error) { toast('Could not create download link: ' + error.message, true); return; }
  window.open(data.signedUrl, '_blank');
}

async function deleteDocument(doc) {
  if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return;
  const { error: rmErr } = await sb.storage.from('documents').remove([doc.storage_path]);
  if (rmErr) { toast('Delete failed: ' + rmErr.message, true); return; }
  const { error: delErr } = await sb.from('documents').delete().eq('id', doc.id);
  if (delErr) { toast('File removed but record delete failed: ' + delErr.message, true); return; }
  toast('Document deleted.');
  await loadDocuments(state.editingId);
}

// ---------- manage users ----------
$('manage-users-btn').addEventListener('click', openUsersModal);
$('users-modal-close-btn').addEventListener('click', () => $('users-modal').classList.add('hidden'));

async function openUsersModal() {
  $('invite-error').textContent = '';
  $('invite-success').textContent = '';
  $('invite-email').value = '';
  await renderUserList();
  $('users-modal').classList.remove('hidden');
}

async function renderUserList() {
  const { data, error } = await sb.from('profiles').select('*').order('email');
  const box = $('user-list');
  box.innerHTML = '';
  if (error) { toast('Could not load users: ' + error.message, true); return; }
  for (const u of data) {
    const row = document.createElement('div');
    row.className = 'user-row';
    const isMe = u.id === state.session.user.id;
    row.innerHTML = `
      <span class="email">${escapeHTML(u.email)}${isMe ? ' (you)' : ''}</span>
      <span class="meta">
        <span class="role-badge">${u.role}</span>
        ${(!isMe && u.role !== 'owner') ? '<button data-action="remove" class="danger">Remove</button>' : ''}
      </span>
    `;
    const removeBtn = row.querySelector('[data-action="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!confirm(`Remove ${u.email}? They will lose access immediately.`)) return;
        try {
          await authedFetch('/.netlify/functions/remove-user', { userId: u.id });
          toast('User removed.');
          await renderUserList();
        } catch (err) {
          toast('Could not remove user: ' + err.message, true);
        }
      });
    }
    box.appendChild(row);
  }
}

$('invite-btn').addEventListener('click', async () => {
  const email = $('invite-email').value.trim();
  $('invite-error').textContent = '';
  $('invite-success').textContent = '';
  if (!email) { $('invite-error').textContent = 'Enter an email address.'; return; }
  try {
    await authedFetch('/.netlify/functions/invite-user', { email });
    $('invite-success').textContent = `Invite sent to ${email}.`;
    $('invite-email').value = '';
    await renderUserList();
  } catch (err) {
    $('invite-error').textContent = err.message;
  }
});
