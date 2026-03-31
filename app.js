// ============================================
// POLITI MDT v3.0 - Professionelt Dansk System
// ============================================

let currentSession = null;
let currentProfile = null;
let selectedCrimes = []; // Liste over valgte paragraffer til beregning
let isLoggingOut = false;

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const session = await _supabase.auth.getSession();
    if (!session.data.session) {
        if (!window.location.href.includes('login.html')) {
            window.location.href = 'login.html';
        }
        return;
    }
    
    currentSession = session.data.session;
    await loadProfile();
    initDashboard();
});

async function loadProfile() {
    const { data: profile } = await _supabase
        .from('betjente')
        .select('*')
        .eq('id', currentSession.user.id)
        .single();
    currentProfile = profile;
}

// ============================================
// DASHBOARD CORE
// ============================================
async function initDashboard() {
    if (!document.getElementById('welcome-msg')) return;

    // 1. Vis/Skjul elementer baseret på profil
    updateUIProfile();
    
    // 2. Tjek FLÅDE SYSTEM (Vagt status)
    checkDutyStatus();

    // 3. Navigation
    setupNavigation();

    // 4. Live Systemer
    startLiveSystems();

    // 5. Load Data
    updateStats();
    loadCriminalCode();
    loadSager();
    loadBoeder();
    loadStraffeattester();
    if (isAdmin()) loadAdminUsers();

    // 6. Listeners
    setupEventListeners();
}

function updateUIProfile() {
    const badge = document.getElementById('user-badge');
    const pnum = document.getElementById('pnum-display');
    
    if (currentProfile) {
        badge.innerText = currentProfile.navn;
        pnum.innerText = currentProfile.p_nummer || 'P-???';
        
        if (currentProfile.rolle === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
        }
    }
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            if (!target) return;

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById(target).classList.add('active');
        });
    });
}

function startLiveSystems() {
    // Live Ur
    setInterval(() => {
        const now = new Date();
        document.getElementById('live-clock').innerText = now.toLocaleTimeString('da-DK', { hour12: false });
    }, 1000);

    // Auto-update stats hver 30. sekund
    setInterval(updateStats, 30000);
}

// ============================================
// FLÅDE & VAGT SYSTEM
// ============================================
function checkDutyStatus() {
    const overlay = document.getElementById('duty-overlay');
    if (!currentProfile.is_on_duty) {
        overlay.style.display = 'flex';
        setupDutySelector();
    } else {
        overlay.style.display = 'none';
        document.getElementById('unit-display').innerText = `ENHED: ${currentProfile.current_unit || 'INGEN'}`;
    }
}

function setupDutySelector() {
    const chips = document.querySelectorAll('.unit-chip');
    let selectedUnit = 'Patrulje';

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            selectedUnit = chip.dataset.unit;
        });
    });

    document.getElementById('go-on-duty-btn').addEventListener('click', async () => {
        const pnumInput = document.getElementById('confirm-pnum').value.toUpperCase().trim();
        const msg = document.getElementById('duty-msg');

        if (pnumInput !== currentProfile.p_nummer.toUpperCase()) {
            msg.innerText = 'FEJL: P-nummer matcher ikke din profil.';
            return;
        }

        // Meld på vagt
        const { error } = await _supabase.from('betjente').update({
            is_on_duty: true,
            current_unit: selectedUnit
        }).eq('id', currentProfile.id);

        if (!error) {
            currentProfile.is_on_duty = true;
            currentProfile.current_unit = selectedUnit;
            document.getElementById('duty-overlay').style.display = 'none';
            document.getElementById('unit-display').innerText = `ENHED: ${selectedUnit}`;
            showToast(`Du er nu tilkoblet som ${selectedUnit}`);
            updateStats();
        }
    });
}

// ============================================
// STRAFFE-BEREGNER (NY VERSION)
// ============================================
async function loadCriminalCode() {
    const container = document.getElementById('straffe-katalog');
    if (!container) return;

    const { data: laws, error } = await _supabase.from('straffelov').select('*').order('paragraf');
    if (error) return;

    container.innerHTML = '';
    laws.forEach(law => {
        const div = document.createElement('div');
        div.className = 'lov-item';
        div.innerHTML = `
            <div>
                <strong style="color:var(--police-accent);">${law.paragraf}</strong> - ${law.titel}
            </div>
            <div style="font-size:0.8rem; color:var(--police-text-muted);">
                ${law.fine_amount ? law.fine_amount.toLocaleString() + ' kr.' : ''} 
                ${law.jail_days ? ' | ' + law.jail_days + ' dg.' : ''}
            </div>
        `;
        div.addEventListener('click', () => toggleCrime(law));
        container.appendChild(div);
    });
}

function toggleCrime(law) {
    const idx = selectedCrimes.findIndex(c => c.id === law.id);
    if (idx > -1) {
        selectedCrimes.splice(idx, 1);
    } else {
        selectedCrimes.push(law);
    }
    updatePenaltySummary();
    
    // Highlight i listen (visuelt)
    // Find alle elementer og match på tekst for simpelhed her
    document.querySelectorAll('.lov-item').forEach(el => {
        if (el.innerText.includes(law.paragraf)) {
            el.style.background = selectedCrimes.find(c => c.id === law.id) ? 'rgba(59, 130, 246, 0.2)' : 'transparent';
        }
    });
}

function updatePenaltySummary() {
    let totalFine = 0;
    let totalJail = 0;

    selectedCrimes.forEach(c => {
        totalFine += c.fine_amount || 0;
        totalJail += c.jail_days || 0;
    });

    document.getElementById('sum-fine').innerText = totalFine.toLocaleString() + ' kr.';
    document.getElementById('sum-jail').innerText = totalJail + ' dage';
}

// UDSTEDELSE
document.getElementById('create-boede-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedCrimes.length === 0) return alert('Vælg mindst én paragraf!');

    const borger = document.getElementById('boede-borger').value;
    const aarsag = document.getElementById('boede-aarsag').value;
    
    let totalFine = 0;
    let totalJail = 0;
    let paragraffer = selectedCrimes.map(c => c.paragraf).join(', ');

    selectedCrimes.forEach(c => {
        totalFine += c.fine_amount || 0;
        totalJail += c.jail_days || 0;
    });

    const { error } = await _supabase.from('boeder').insert([{
        user_name: borger,
        user_discord_id: borger, // Vi bruger navnet som ID hvis ikke andet haves
        amount: totalFine,
        jail_days: totalJail,
        paragraf: paragraffer,
        reason: aarsag,
        officer_id: currentProfile.id,
        officer_name: currentProfile.navn,
        kilde: 'web'
    }]);

    if (!error) {
        showToast('Straf er udstedt og journalført.');
        selectedCrimes = [];
        updatePenaltySummary();
        e.target.reset();
        loadBoeder();
        loadStraffeattester();
        // Nulstil highlights
        document.querySelectorAll('.lov-item').forEach(el => el.style.background = 'transparent');
    } else {
        alert('Fejl: ' + error.message);
    }
});

// ============================================
// STATS & DATA
// ============================================
async function updateStats() {
    // Total sager
    const { count: sager } = await _supabase.from('sager').select('*', { count: 'exact', head: true });
    document.getElementById('stat-total-sager').innerText = sager || 0;

    // Efterlyste (Vi tæller borgere markeret som efterlyst - kræver kolonne, men her bruger vi aktive bøder som proxy)
    const { data: wantedData } = await _supabase.from('boeder').select('user_discord_id').eq('afsonet', false);
    const uniqueWanted = new Set(wantedData?.map(b => b.user_discord_id));
    document.getElementById('stat-wanted').innerText = uniqueWanted.size;

    // Personer
    const { count: borgere } = await _supabase.from('borgere').select('*', { count: 'exact', head: true });
    document.getElementById('stat-born').innerText = borgere || 0;

    // Aktive betjente
    const { count: aktive } = await _supabase.from('betjente').select('*', { count: 'exact', head: true }).eq('is_on_duty', true);
    document.getElementById('stat-active').innerText = aktive || 0;

    // Opdater Feed (Seneste sager)
    const { data: activity } = await _supabase.from('boeder').select('*').order('created_at', { ascending: false }).limit(5);
    const feed = document.getElementById('recent-activity');
    if (feed) {
        feed.innerHTML = activity?.map(a => `
            <div style="margin-bottom:10px; border-bottom:1px solid #334155; padding-bottom:5px;">
                <span class="badge" style="background:var(--police-accent);">BØDE</span> 
                <strong>${a.user_name}</strong> fik ${a.amount.toLocaleString()} kr. af ${a.officer_name}
            </div>
        `).join('') || 'Ingen nylig aktivitet.';
    }
}

// ============================================
// LUKKE SPÆRRING
// ============================================
window.addEventListener('beforeunload', (e) => {
    if (currentProfile?.is_on_duty && !isLoggingOut) {
        e.preventDefault();
        e.returnValue = 'Du er stadig på vagt! Du skal logge af vagt før du lukker MDT.';
    }
});

document.getElementById('nav-logout').addEventListener('click', async () => {
    if (confirm('Vil du afslutte din vagt og logge ud?')) {
        isLoggingOut = true;
        await _supabase.from('betjente').update({ is_on_duty: false }).eq('id', currentProfile.id);
        await _supabase.auth.signOut();
        window.location.href = 'login.html';
    }
});

// ============================================
// HELPERS
// ============================================
function isAdmin() { return currentProfile?.rolle === 'admin'; }

function showToast(msg) {
    const t = document.getElementById('notif-toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 4000);
}

// Genbruger eksisterende sags-logik med små UI tilpasninger
async function loadSager(query = '') {
    const list = document.getElementById('sags-liste');
    if (!list) return;

    let q = _supabase.from('sager').select('*').is('slettet_dato', null).order('oprettet_dato', { ascending: false });
    if (query) q = q.or(`navn.ilike.%${query}%,cpr.ilike.%${query}%`);

    const { data } = await q;
    list.innerHTML = data?.map(s => `
        <div class="stat-card" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong>${s.navn}</strong><br>
                <span style="font-size:0.8rem; color:var(--police-text-muted);">CPR: ${s.cpr}</span>
            </div>
            <button class="btn-secondary" onclick="openEditModal('${s.id}')">SE SAG</button>
        </div>
    `).join('') || 'Ingen sager fundet.';
}

// Søge-event
document.getElementById('search-input')?.addEventListener('input', (e) => {
    loadSager(e.target.value);
});

// INITIALISERING AF ANDRE LISTER
async function loadBoeder() {
    const list = document.getElementById('boeder-liste');
    if (!list) return;
    const { data } = await _supabase.from('boeder').select('*').is('slettet_dato', null).order('created_at', { ascending: false });
    list.innerHTML = data?.map(b => `
        <div class="stat-card" style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between;">
                <strong>⚖️ ${b.user_name}</strong>
                <span class="badge ${b.afsonet ? 'on-duty-badge' : 'off-duty-badge'}">${b.afsonet ? 'AFSONET' : 'MANGLER'}</span>
            </div>
            <div style="margin-top:5px; font-size:0.9rem;">
                ${b.amount.toLocaleString()} kr. | ${b.jail_days || 0} dage<br>
                <span style="color:var(--police-text-muted); font-size:0.8rem;">${b.paragraf}</span>
            </div>
        </div>
    `).join('') || 'Ingen bøder.';
}

async function loadStraffeattester(query = '') {
    const list = document.getElementById('attester-liste');
    if (!list) return;
    const { data: borgere } = await _supabase.from('borgere').select('*').order('visningsnavn');
    list.innerHTML = borgere?.filter(b => b.visningsnavn.toLowerCase().includes(query.toLowerCase())).map(b => `
        <div class="lov-item" onclick="viewAttest('${b.discord_id}')">
            <span>👤 ${b.visningsnavn}</span>
            <span style="font-size:0.8rem; color:var(--police-accent);">SE ATTEST</span>
        </div>
    `).join('') || 'Ingen borgere fundet.';
}

function setupEventListeners() {
    document.getElementById('search-attest-input')?.addEventListener('input', (e) => {
        loadStraffeattester(e.target.value);
    });
}
