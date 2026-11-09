// Classic script on purpose: wire controls before loading Firebase so the page can show useful errors if the SDK is blocked.
(() => {
  'use strict';
  window.kernalsAppStarted = true;
  const $ = (id) => document.getElementById(id);
  const config = {
    apiKey: 'AIzaSyC8QLXhKJaRHdi_BpC-Sm-A8uc7uhOAQwY',
    authDomain: 'privatechat-b39d3.firebaseapp.com',
    projectId: 'privatechat-b39d3',
    storageBucket: 'privatechat-b39d3.firebasestorage.app',
    messagingSenderId: '1031388982221',
    appId: '1:1031388982221:web:2807b429e387eff320f284'
  };
  const channels = ['general', 'announcements', 'help'];
  let firebase, auth, db, currentUser = null, profile = null;
  let active = { type: 'channel', id: 'general', name: 'general' };
  let stopAuth = null, stopMessages = null, stopDMs = null, busy = false;

  function setStatus(message, kind = '') {
    const node = $('authStatus');
    node.textContent = message;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }
  function explain(error) {
    const known = {
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/invalid-credential': 'That email or password is incorrect.',
      'auth/user-not-found': 'No account exists for that email.',
      'auth/wrong-password': 'That email or password is incorrect.',
      'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
      'auth/weak-password': 'Use a password with at least 6 characters.',
      'auth/operation-not-allowed': 'Email/password sign-in is disabled in Firebase Authentication settings.',
      'auth/unauthorized-domain': 'This site domain is not authorized in Firebase Authentication settings.',
      'permission-denied': 'Firebase Firestore denied access. Check the project’s Firestore security rules.'
    };
    return known[error?.code] || error?.message || String(error || 'Unknown error');
  }
  function showApp(show) {
    $('authScreen').classList.toggle('hidden', show);
    $('appScreen').classList.toggle('hidden', !show);
  }
  function initials(text) { return (text || '?').trim().slice(0, 1).toUpperCase(); }
  function renderProfile() {
    const name = profile?.username || currentUser?.email || 'Member';
    $('profileName').textContent = name;
    $('profileAvatar').textContent = initials(name);
  }
  function renderChannels() {
    const root = $('channelList');
    root.replaceChildren();
    channels.forEach((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'channel' + (active.type === 'channel' && active.id === name ? ' active' : '');
      button.textContent = '# ' + name;
      button.addEventListener('click', () => selectChannel(name));
      root.append(button);
    });
  }
  function renderDMs(items = []) {
    const root = $('dmList');
    root.replaceChildren();
    if (!items.length) {
      const note = document.createElement('div'); note.className = 'note'; note.textContent = 'Start one with + DM.'; root.append(note); return;
    }
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dm-item' + (active.type === 'dm' && active.id === item.id ? ' active' : '');
      button.textContent = '@ ' + (item.profile?.username || 'Member');
      button.addEventListener('click', () => selectDM(item.id, item.profile));
      root.append(button);
    });
  }
  function messageCollection() {
    return active.type === 'channel'
      ? firebase.collection(db, 'channels', active.id, 'messages')
      : firebase.collection(db, 'conversations', active.id, 'messages');
  }
  function renderMessages(items) {
    const root = $('messages');
    root.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No messages yet. Start the conversation.'; root.append(empty); return;
    }
    items.forEach((message) => {
      const row = document.createElement('article'); row.className = 'msg';
      const avatar = document.createElement('span'); avatar.className = 'avatar msg-avatar'; avatar.textContent = initials(message.author);
      const body = document.createElement('div');
      const head = document.createElement('div'); head.className = 'mhead';
      const author = document.createElement('strong'); author.className = 'mname'; author.textContent = message.author || 'Member';
      const time = document.createElement('time'); time.className = 'mtime';
      const date = message.createdAt?.toDate ? message.createdAt.toDate() : null;
      time.textContent = date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Just now';
      head.append(author, time);
      const text = document.createElement('div'); text.className = 'mtext'; text.textContent = message.text || '';
      body.append(head, text); row.append(avatar, body); root.append(row);
    });
    root.scrollTop = root.scrollHeight;
  }
  function setConnection(text, error = false) {
    $('connectionStatus').textContent = text;
    $('connectionStatus').style.color = error ? 'var(--danger)' : '';
  }
  function stopActiveListeners() {
    if (stopMessages) stopMessages();
    stopMessages = null;
  }
  function watchActive() {
    stopActiveListeners();
    $('titlePrefix').textContent = active.type === 'channel' ? '#' : '@';
    $('currentName').textContent = active.name;
    $('composer').placeholder = 'Message ' + (active.type === 'channel' ? '#' : '@') + active.name;
    renderChannels();
    setConnection('Connecting…');
    $('messages').replaceChildren();
    stopMessages = firebase.onSnapshot(
      firebase.query(messageCollection(), firebase.orderBy('createdAt', 'asc'), firebase.limit(300)),
      (snapshot) => { setConnection('Connected'); renderMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))); },
      (error) => { setConnection('Database error', true); renderMessages([]); setStatus('Chat database error: ' + explain(error), 'error'); }
    );
  }
  function selectChannel(name) {
    active = { type: 'channel', id: name, name };
    $('layoutRoot').classList.remove('nav-open');
    watchActive();
  }
  function selectDM(id, otherProfile) {
    active = { type: 'dm', id, name: otherProfile?.username || 'Member' };
    $('layoutRoot').classList.remove('nav-open');
    watchActive();
  }
  async function ensureProfile(user) {
    const ref = firebase.doc(db, 'profiles', user.uid);
    const snapshot = await firebase.getDoc(ref);
    if (snapshot.exists()) return snapshot.data();
    const base = (user.displayName || user.email?.split('@')[0] || 'member').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 18) || 'member';
    const fallback = { username: base + '-' + user.uid.slice(0, 5).toLowerCase(), usernameLower: base + '-' + user.uid.slice(0, 5).toLowerCase() };
    await firebase.setDoc(ref, { ...fallback, createdAt: firebase.serverTimestamp() }, { merge: true });
    return fallback;
  }
  function watchDMs() {
    if (stopDMs) stopDMs();
    stopDMs = firebase.onSnapshot(
      firebase.query(firebase.collection(db, 'conversations'), firebase.where('members', 'array-contains', currentUser.uid)),
      async (snapshot) => {
        try {
          const found = await Promise.all(snapshot.docs.map(async (conversation) => {
            const otherUid = (conversation.data().members || []).find((uid) => uid !== currentUser.uid);
            if (!otherUid) return null;
            const other = await firebase.getDoc(firebase.doc(db, 'profiles', otherUid));
            return { id: conversation.id, profile: other.exists() ? other.data() : { username: 'Member' } };
          }));
          renderDMs(found.filter(Boolean));
        } catch (error) { setStatus('Could not load direct messages: ' + explain(error), 'error'); }
      },
      (error) => setStatus('Direct message access error: ' + explain(error), 'error')
    );
  }
  async function submitAuth(event) {
    event.preventDefault();
    if (!firebase || busy) return;
    const email = $('emailInput').value.trim();
    const password = $('passwordInput').value;
    const signup = Boolean(window.kernalsSignupMode);
    const submit = $('authSubmit');
    busy = true; submit.disabled = true;
    setStatus(signup ? 'Creating account…' : 'Signing in…');
    try {
      if (signup) {
        const username = $('usernameInput').value.trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_-]{3,24}$/.test(username)) throw new Error('Username must be 3–24 letters, numbers, underscores, or hyphens.');
        const credential = await firebase.createUserWithEmailAndPassword(auth, email, password);
        await firebase.updateProfile(credential.user, { displayName: username });
        const profileRef = firebase.doc(db, 'profiles', credential.user.uid);
        const handleRef = firebase.doc(db, 'usernames', username);
        await firebase.runTransaction(db, async (transaction) => {
          const existing = await transaction.get(handleRef);
          if (existing.exists() && existing.data().uid !== credential.user.uid) throw new Error('That username is already taken.');
          transaction.set(handleRef, { uid: credential.user.uid });
          transaction.set(profileRef, { username, usernameLower: username, photoURL: '', createdAt: firebase.serverTimestamp() }, { merge: true });
        });
      } else {
        await firebase.signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      console.error('Kernals sign-in error:', error);
      setStatus(explain(error), 'error');
    } finally { busy = false; submit.disabled = false; }
  }
  async function sendMessage(event) {
    event?.preventDefault();
    const text = $('composer').value.trim();
    if (!text || !currentUser || busy) return;
    busy = true; $('sendBtn').disabled = true;
    try {
      await firebase.addDoc(messageCollection(), {
        author: profile?.username || currentUser.displayName || currentUser.email || 'Member',
        authorUid: currentUser.uid,
        text,
        createdAt: firebase.serverTimestamp()
      });
      $('composer').value = '';
      $('composer').style.height = '40px';
      $('composer').focus();
      setStatus('');
    } catch (error) {
      console.error('Kernals message error:', error);
      setStatus('Message not sent: ' + explain(error), 'error');
    } finally { busy = false; $('sendBtn').disabled = false; }
  }
  async function startDM() {
    const typed = window.prompt('Enter the exact username to message (without @):');
    if (!typed || !currentUser) return;
    const username = typed.trim().replace(/^@/, '').toLowerCase();
    try {
      const handle = await firebase.getDoc(firebase.doc(db, 'usernames', username));
      if (!handle.exists()) throw new Error('No user found with that username.');
      const otherUid = handle.data().uid;
      if (otherUid === currentUser.uid) throw new Error('You cannot start a DM with yourself.');
      const members = [currentUser.uid, otherUid].sort();
      const id = members.join('_');
      const ref = firebase.doc(db, 'conversations', id);
      if (!(await firebase.getDoc(ref)).exists()) await firebase.setDoc(ref, { members, createdAt: firebase.serverTimestamp() });
      const otherProfile = await firebase.getDoc(firebase.doc(db, 'profiles', otherUid));
      selectDM(id, otherProfile.exists() ? otherProfile.data() : { username });
      setStatus('');
    } catch (error) { setStatus(explain(error), 'error'); }
  }
  function bindControls() {
    $('authForm').addEventListener('submit', submitAuth);
    $('composerForm').addEventListener('submit', sendMessage);
    $('composer').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); }
    });
    $('composer').addEventListener('input', () => {
      const input = $('composer'); input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    $('newDmBtn').addEventListener('click', startDM);
    $('newChannelBtn').addEventListener('click', () => {
      const raw = window.prompt('New channel name:');
      if (!raw) return;
      const name = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      if (!name) return;
      if (!channels.includes(name)) channels.push(name);
      selectChannel(name);
    });
    $('navToggle').addEventListener('click', () => $('layoutRoot').classList.toggle('nav-open'));
    $('logoutBtn').addEventListener('click', async () => {
      try { await firebase.signOut(auth); }
      catch (error) { setStatus('Could not log out: ' + explain(error), 'error'); }
    });
  }
  async function start() {
    bindControls();
    renderChannels();
    try {
      setStatus('Loading Firebase…');
      const version = '10.12.2';
      const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
      ]);
      firebase = { ...appSdk, ...authSdk, ...firestoreSdk };
      const app = firebase.initializeApp(config);
      auth = firebase.getAuth(app);
      db = firebase.getFirestore(app);
      setStatus('Firebase loaded. Sign in or create an account.', 'ok');
      stopAuth = firebase.onAuthStateChanged(auth, async (user) => {
        if (!user) {
          currentUser = null; profile = null;
          if (stopMessages) stopMessages(); stopMessages = null;
          if (stopDMs) stopDMs(); stopDMs = null;
          showApp(false);
          return;
        }
        currentUser = user;
        try {
          profile = await ensureProfile(user);
          renderProfile(); showApp(true); watchDMs(); selectChannel('general'); setStatus('');
        } catch (error) {
          console.error('Kernals profile error:', error);
          renderProfile(); showApp(true);
          setStatus('Signed in, but profile/Firestore setup failed: ' + explain(error), 'error');
          selectChannel('general');
        }
      }, (error) => setStatus('Firebase authentication error: ' + explain(error), 'error'));
    } catch (error) {
      console.error('Kernals Firebase startup error:', error);
      setStatus('Firebase could not start: ' + explain(error) + '. Check internet access/content blockers, then reload.', 'error');
      setConnection('Firebase unavailable', true);
    }
  }
  start();
})();
