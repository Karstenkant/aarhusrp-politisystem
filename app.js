// ============================================
// POLITI MDT v2.0 - Komplet System
// ============================================

let currentSession = null;
let currentProfile = null;
let inactivityTimer = null;
let isLoggingOut = false; // Flag til at undgå popup ved logud
const LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutter

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    if (document.getElementById('login-form')) {
        initLogin();
    } else if (document.getElementById('user-name')) {
        initDashboard();
    }
});

async function checkAuth() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    return session;
}

// ============================================
// LOGIN
// ============================================
function initLogin() {
    const loginForm = document.getElementById('login-form');
    const errorMsg = document.getElementById('error-msg');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMsg.innerText = 'Logger ind...';
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        const { data, error } = await _supabase.auth.signInWithPassword({ email, password });

        if (error) {
            errorMsg.innerText = "Fejl: " + error.message;
        } else {
            window.location.href = 'dashboard.html';
        }
    });
}

// ============================================
// DASHBOARD
// ============================================
async function initDashboard() {
    // 1. Auth check
    const session = await checkAuth();
    if (!session) return;
    currentSession = session;

    // 2. Hent profil
    const { data: profile } = await _supabase
        .from('betjente')
        .select('*')
        .eq('id', session.user.id)
        .single();
    currentProfile = profile;

    if (profile) {
        document.getElementById('user-name').innerText = profile.navn;
        document.getElementById('user-role').innerText = profile.rolle.toUpperCase();
        if (isOfficer()) {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
        }
        if (profile.rolle === 'admin') {
            document.body.classList.add('is-admin');
        }
    }

    // 3. Navigation setup
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById(target).classList.add('active');
        });
    });

    // 4. Tjek vagt status!
    await checkDutyStatus();

    // 5. Load data
    loadSager();
    loadBoeder();
    loadTrash();
    loadStraffeattester();
    if (isAdmin()) {
        loadAdminUsers();
        setupAdminPanel();
    }

    // 6. Security & Profile
    setupSecurityLocks();
    setupProfileSecurity();
    setupCreateSag();
    setupCreateBoede();
    setupEditModal();
    setupRealtime();

    // 7. Event listeners for knapper
    document.getElementById('clock-out-btn')?.addEventListener('click', clockOutAndLogout);
    document.getElementById('duty-logout')?.addEventListener('click', clockOutAndLogout);
    document.getElementById('filter-btn')?.addEventListener('click', () => {
        const query = document.getElementById('search-input').value;
        const from = document.getElementById('filter-from').value;
        const to = document.getElementById('filter-to').value;
        loadSager(query, from, to);
    });

    // Søgning i straffeattester
    document.getElementById('search-attest-input')?.addEventListener('input', (e) => {
        loadStraffeattester(e.target.value);
    });
}

// ============================================
// OBLIGATORISK VAGT SYSTEM
// ============================================
let activeDutyId = localStorage.getItem('activeDutyId');

async function checkDutyStatus() {
    const dutyModal = document.getElementById('duty-screen');
    const badge = document.getElementById('vagt-status');
    const btn = document.getElementById('clock-in-btn');
    if (!dutyModal) return;

    const { data } = await _supabase.from('vagt_log')
        .select('*')
        .eq('betjent_id', currentSession.user.id)
        .is('slut_tid', null)
        .order('start_tid', { ascending: false })
        .limit(1);

    if (data && data.length > 0) {
        activeDutyId = data[0].id;
        localStorage.setItem('activeDutyId', activeDutyId);
        dutyModal.style.display = 'none';
        badge.style.display = 'inline-block';
    } else {
        activeDutyId = null;
        localStorage.removeItem('activeDutyId');
        dutyModal.style.display = 'flex';
        badge.style.display = 'none';
    }

    btn?.addEventListener('click', async () => {
        btn.innerHTML = 'Indstempler...';
        const { data: newDuty, error } = await _supabase.from('vagt_log').insert({
            betjent_id: currentSession.user.id
        }).select().single();

        if (!error) {
            activeDutyId = newDuty.id;
            localStorage.setItem('activeDutyId', activeDutyId);
            dutyModal.style.display = 'none';
            badge.style.display = 'inline-block';
        } else {
            alert('Fejl: ' + error.message);
            btn.innerHTML = 'MELD PÅ VAGT NU';
        }
    });
}

async function clockOutAndLogout() {
    isLoggingOut = true; // Sæt flag så før-luk advarsel ikke kommer
    if (activeDutyId) {
        await _supabase.from('vagt_log').update({ slut_tid: new Date().toISOString() }).eq('id', activeDutyId);
    }
    localStorage.removeItem('activeDutyId');
    await _supabase.auth.signOut();
    window.location.href = 'login.html';
}

window.addEventListener('beforeunload', (e) => {
    if (activeDutyId && !isLoggingOut) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ============================================
// LOAD & RENDER FUNKTIONER
// ============================================

async function loadSager(query = '', from = '', to = '') {
    const list = document.getElementById('sags-liste');
    if (!list) return;
    list.innerHTML = '<div class="loading">Henter sager...</div>';

    // Vi prøver at hente med join, men falder tilbage til simpel select hvis det fejler (pga. FK navne)
    let q = _supabase.from('sager').select('*, betjente(navn)')
        .is('slettet_dato', null)
        .order('oprettet_dato', { ascending: false });

    if (query) q = q.or(`navn.ilike.%${query}%,cpr.ilike.%${query}%`);
    if (from) q = q.gte('oprettet_dato', from);
    if (to) q = q.lte('oprettet_dato', to + 'T23:59:59');

    let { data, error } = await q;
    
    // Hvis join fejlede pga. relationer, prøv uden join
    if (error && error.message.includes('relationship')) {
        console.warn('FK join fejlede, prøver uden betjente-navn...');
        const retry = await _supabase.from('sager').select('*')
            .is('slettet_dato', null)
            .order('oprettet_dato', { ascending: false });
        data = retry.data;
        error = retry.error;
    }

    if (error) { list.innerHTML = `<div class="error">${error.message}</div>`; return; }

    list.innerHTML = '';
    data.forEach(sag => {
        const canEdit = isAdmin() || sag.oprettet_af === currentSession.user.id;
        const card = document.createElement('div');
        card.className = 'sag-card';
        card.innerHTML = `
            <div class="sag-info">
                <h3>${escapeHtml(sag.navn)}</h3>
                <div class="sag-meta">CPR: ${escapeHtml(sag.cpr)} | ${formatDate(sag.oprettet_dato)}</div>
            </div>
            <div class="sag-actions">
                ${canEdit ? `<button class="btn-sm btn-edit" data-id="${sag.id}">ÅBEN</button>` : ''}
                ${canEdit ? `<button class="btn-sm btn-delete" data-id="${sag.id}">SLET</button>` : ''}
            </div>`;
        list.appendChild(card);
    });

    list.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.id)));
    list.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => softDeleteSag(b.dataset.id)));
}

async function loadBoeder() {
    const list = document.getElementById('boeder-liste');
    if (!list) return;
    list.innerHTML = '<div class="loading">Henter bøder...</div>';

    const { data, error } = await _supabase.from('boeder').select('*').is('slettet_dato', null).order('created_at', { ascending: false });
    if (error) { list.innerHTML = '<div class="error">Fejl.</div>'; return; }

    list.innerHTML = '';
    data.forEach(b => {
        const card = document.createElement('div');
        card.className = 'sag-card boede-card';
        card.innerHTML = `
            <div class="sag-info">
                <h3>⚖️ ${escapeHtml(b.user_name || b.user_discord_id)}</h3>
                <div class="sag-meta"><strong>${b.amount.toLocaleString('da-DK')} DKK</strong> | Status: ${b.afsonet ? '🟢' : '🔴'}</div>
                <div class="sag-meta">Årsag: ${escapeHtml(b.reason || 'Ingen')}</div>
            </div>
            <div class="sag-actions">
                ${!b.afsonet && isAdmin() ? `<button class="btn-sm btn-edit mark-afsonet" data-id="${b.id}">✅ Løslad</button>` : ''}
            </div>`;
        list.appendChild(card);
    });

    list.querySelectorAll('.mark-afsonet').forEach(b => b.addEventListener('click', () => setAfsonet(b.dataset.id)));
}

async function setAfsonet(id) {
    if (confirm('Markér som afsonet?')) {
        await _supabase.from('boeder').update({ afsonet: true }).eq('id', id);
        loadBoeder();
    }
}

async function loadStraffeattester(searchQuery = '') {
    const list = document.getElementById('attester-liste');
    if (!list) return;
    list.innerHTML = '<div class="loading">Henter...</div>';

    const { data: borgere } = await _supabase.from('borgere').select('*').order('visningsnavn', { ascending: true });
    const { data: boeder } = await _supabase.from('boeder').select('*').is('slettet_dato', null);

    if (!borgere) return;

    const grouped = {};
    borgere.forEach(borger => {
        grouped[borger.discord_id] = { ...borger, total_gald: 0, boeder: [], isAfsoner: false };
    });

    boeder?.forEach(b => {
        if (grouped[b.user_discord_id]) {
            grouped[b.user_discord_id].total_gald += b.amount;
            grouped[b.user_discord_id].boeder.push(b);
            if (!b.afsonet) grouped[b.user_discord_id].isAfsoner = true;
        }
    });

    list.innerHTML = '';
    const query = searchQuery.toLowerCase();
    Object.values(grouped).forEach(p => {
        const nameMatch = p.visningsnavn?.toLowerCase().includes(query);
        const idMatch = p.discord_id?.toString() === query;
        const partialIdMatch = p.discord_id?.toString().includes(query);
        
        if (query && !nameMatch && !idMatch && !partialIdMatch) return;
        
        const card = document.createElement('div');
        card.className = 'sag-card';
        card.style.borderLeft = personBorder(p);
        card.innerHTML = `
            <div class="sag-info">
                <h3>👤 ${escapeHtml(p.visningsnavn)}</h3>
                <div class="sag-meta">ID: ${escapeHtml(p.discord_id)} | Rolle: ${escapeHtml(p.roller)} | Gæld: ${p.total_gald.toLocaleString('da-DK')} DKK</div>
                <div class="sag-meta">Status: ${p.isAfsoner ? '🔴 AFSONER' : (p.boeder.length > 0 ? '🟡 Løsladt' : '🟢 Ren')}</div>
            </div>
            <div class="sag-actions">
                <button class="btn-sm btn-primary view-attest-btn">📜 Åbn Attest</button>
            </div>`;
        card.querySelector('.view-attest-btn').addEventListener('click', () => openAttestModal(p));
        list.appendChild(card);
    });
}

function personBorder(p) {
    if (p.isAfsoner) return '5px solid var(--error-red)';
    if (p.boeder.length > 0) return '5px solid var(--police-yellow)';
    return '5px solid var(--success-green)';
}

// ============================================
// MODALS & ACTIONS
// ============================================

function openAttestModal(person) {
    const modal = document.getElementById('attest-modal');
    document.getElementById('attest-modal-title').innerText = `Straffeattest: ${person.visningsnavn}`;
    let html = `<div class="attest-summary">
        <p><strong>Discord ID:</strong> ${person.discord_id}</p>
        <p><strong>Gæld:</strong> ${person.total_gald.toLocaleString('da-DK')} DKK</p>
        <p><strong>Status:</strong> ${person.isAfsoner ? '🔴 Afsoner' : '🟢 Fri'}</p>
    </div><hr><ul>`;
    person.boeder.forEach(b => {
        html += `<li><strong>${b.amount} DKK</strong> - ${escapeHtml(b.reason)} (${formatDate(b.created_at)})</li>`;
    });
    html += '</ul>';
    document.getElementById('attest-modal-body').innerHTML = html;
    modal.style.display = 'block';
}

function setupSecurityLocks() {
    const reset = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            document.getElementById('lock-screen').style.display = 'flex';
        }, LOCK_TIMEOUT);
    };
    ['mousemove', 'mousedown', 'keypress'].forEach(e => document.addEventListener(e, reset));
    reset();

    document.getElementById('unlock-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('unlock-password').value;
        const { error } = await _supabase.auth.signInWithPassword({ email: currentSession.user.email, password: pwd });
        if (!error) {
            document.getElementById('lock-screen').style.display = 'none';
            document.getElementById('unlock-password').value = '';
            reset();
        } else {
            alert('Forkert kode!');
        }
    });
}

function setupProfileSecurity() {
    document.getElementById('change-password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const p1 = document.getElementById('new-pwd').value;
        const p2 = document.getElementById('new-pwd-confirm').value;
        if (p1 !== p2) return alert('Kodeord stemmer ikke overens!');
        const { error } = await _supabase.auth.updateUser({ password: p1 });
        if (!error) { alert('✅ Kodeord ændret!'); e.target.reset(); }
        else { alert('Fejl: ' + error.message); }
    });
}

function setupCreateSag() {
    document.getElementById('create-sag-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            navn: document.getElementById('sag-navn').value,
            foedselsdag: document.getElementById('sag-dato').value,
            cpr: document.getElementById('sag-cpr').value,
            beskrivelse: document.getElementById('sag-beskrivelse').value,
            oprettet_af: currentSession.user.id,
            sidst_redigeret_af: currentSession.user.id
        };
        const { data: sag, error } = await _supabase.from('sager').insert([data]).select().single();
        if (!error) {
            await _supabase.from('sags_logs').insert([{ sags_id: sag.id, bruger_id: currentSession.user.id, handling: 'opret' }]);
            alert('✅ Sag oprettet!');
            e.target.reset();
        }
    });
}

function setupCreateBoede() {
    document.getElementById('new-boede-btn')?.addEventListener('click', () => {
        const f = document.getElementById('boede-form-container');
        if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('create-boede-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            user_discord_id: document.getElementById('boede-borger').value,
            user_name: document.getElementById('boede-borger').value,
            amount: parseFloat(document.getElementById('boede-beloeb').value),
            paragraf: document.getElementById('boede-paragraf').value,
            reason: document.getElementById('boede-aarsag').value,
            officer_id: currentSession.user.id,
            officer_name: currentProfile?.navn || 'MDT',
            kilde: 'web'
        };
        const { error } = await _supabase.from('boeder').insert([data]);
        if (!error) { alert('✅ Bøde udstedt!'); e.target.reset(); document.getElementById('boede-form-container').style.display='none'; }
    });
}

function setupEditModal() {
    document.getElementById('close-attest-modal')?.addEventListener('click', () => {
        document.getElementById('attest-modal').style.display = 'none';
    });
}

function setupRealtime() {
    _supabase.channel('mdt-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sager' }, () => loadSager())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'boeder' }, () => loadBoeder())
        .subscribe();
}

async function loadAdminUsers() {
    const list = document.getElementById('user-list');
    if (!list) return;
    const { data: users } = await _supabase.from('betjente').select('*').order('navn');
    list.innerHTML = '';
    users?.forEach(u => {
        const div = document.createElement('div');
        div.className = 'admin-user-card';
        div.innerHTML = `<span>${escapeHtml(u.navn)} (${u.rolle})</span>
            <button class="btn-sm btn-delete del-user" data-id="${u.id}">SLET</button>`;
        list.appendChild(div);
    });
    list.querySelectorAll('.del-user').forEach(b => b.addEventListener('click', () => deleteUserAccount(b.dataset.id)));
}

async function deleteUserAccount(id) {
    if (confirm('Slet bruger?')) {
        const { data: { session } } = await _supabase.auth.getSession();
        await fetch(SUPABASE_URL + '/functions/v1/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
            body: JSON.stringify({ targetUserId: id })
        });
        loadAdminUsers();
    }
}

async function loadTrash() {
    const list = document.getElementById('trash-liste');
    if (!list) return;
    const { data } = await _supabase.from('sager').select('*').not('slettet_dato', 'is', null);
    list.innerHTML = data?.length ? '' : 'Ingen sager i papirkurven.';
    data?.forEach(s => {
        const card = document.createElement('div');
        card.className = 'sag-card';
        card.innerHTML = `<h3>${s.navn}</h3><button class="btn-sm" onclick="restoreSag('${s.id}')">GENDAN</button>`;
        list.appendChild(card);
    });
}

// ============================================
// HELPERS
// ============================================
function isAdmin() { return currentProfile?.rolle === 'admin'; }
function isOfficer() { return currentProfile && (currentProfile.rolle === 'admin' || currentProfile.rolle === 'betjent' || currentProfile.rolle === 'kadet'); }
function escapeHtml(text) { const div = document.createElement('div'); div.innerText = text || ''; return div.innerHTML; }
function formatDate(d) { return d ? new Date(d).toLocaleDateString('da-DK', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Ukendt'; }
