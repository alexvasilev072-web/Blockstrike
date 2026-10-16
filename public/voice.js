// Гласов чат: WebRTC peer-to-peer (всеки с всеки), сигнализацията минава през Socket.io (vc:signal).
// - Микрофонът се иска чак при първото натискане на клавиша за говорене (push-to-talk, по подразбиране V).
// - В рунд (състезателен режим) говориш само със своя отбор; в лобито и в parkour/surf – с всички.
// - Ботовете се игнорират. TURN сървър се задава от сървъра през променливи на средата (виж /api/ice и README).
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const MUTE_KEY = 'bs_vmute';

export function initVoice({ socket, getMyId, getPlayers, canTalk, settings, onChange, onError }) {
  const peers = new Map(), talking = new Set();
  let ice = null, stream = null, track = null, ptt = false;
  const muted = new Set((() => { try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '[]'); } catch { return []; } })());
  const saveMuted = () => { try { localStorage.setItem(MUTE_KEY, JSON.stringify([...muted])); } catch { } };
  const nameOf = id => getPlayers().find(p => p.id === id)?.name;

  async function getIce() {
    if (ice) return ice;
    try { ice = (await (await fetch('/api/ice')).json()).iceServers || STUN; } catch { ice = STUN; }
    return ice;
  }
  function applyOne(P) {
    if (!P.tr) return;
    const ok = settings.voice && canTalk(P.id);
    // изпращане: само на тези, с които имаме право да говорим (иначе песента се маха от връзката)
    const want = ok && track ? track : null;
    if (P.sent !== want) { P.sent = want; P.tr.sender.replaceTrack(want).catch(() => { }); }
    if (P.audio) { P.audio.muted = !ok || muted.has(nameOf(P.id)); P.audio.volume = Math.max(0, Math.min(1, settings.voiceVol)); }
  }
  function applyPolicy() { for (const P of peers.values()) applyOne(P); }

  async function connect(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: await getIce() });
    const P = { id, pc, tr: null, audio: null, queue: [], remote: false, sent: null };
    peers.set(id, P);
    const offerer = String(getMyId()) < String(id);                              // предложение прави този с по-малкия id (без „glare“)
    // предлагащият създава трансивъра (получава звук още преди да е включил микрофон); отговарящият ползва този от предложението (виж по-долу)
    if (offerer) P.tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.onicecandidate = e => { if (e.candidate) socket.emit('vc:signal', { to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = e => {
      const a = new Audio(); a.autoplay = true; a.srcObject = e.streams[0] || new MediaStream([e.track]); P.audio = a; applyOne(P);
      a.play?.().catch(() => { });
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { close(id); setTimeout(sync, 1500); } };
    if (offerer) {
      try { await pc.setLocalDescription(await pc.createOffer()); socket.emit('vc:signal', { to: id, data: { sdp: pc.localDescription } }); } catch { }
    }
    applyOne(P); return P;
  }
  function close(id) {
    const P = peers.get(id); if (!P) return;
    try { P.pc.close(); } catch { } if (P.audio) { P.audio.srcObject = null; P.audio = null; }
    peers.delete(id); if (talking.delete(id)) onChange();
  }
  function closeAll() { for (const id of [...peers.keys()]) close(id); talking.clear(); onChange(); }
  // синхронизира връзките със списъка на хората в стаята (без ботове)
  function sync() {
    if (!settings.voice || !getMyId() || typeof RTCPeerConnection === 'undefined') { closeAll(); return; }
    const want = new Set(getPlayers().filter(p => !p.bot && p.id !== getMyId()).map(p => p.id));
    for (const id of [...peers.keys()]) if (!want.has(id)) close(id);
    for (const id of want) if (!peers.has(id)) connect(id);
    applyPolicy();
  }
  socket.on('vc:signal', async ({ from, data }) => {
    if (!settings.voice || !data) return;
    try {
      const P = peers.get(from) || await connect(from), pc = P.pc;
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp); P.remote = true;
        if (data.sdp.type === 'offer' && !P.tr) { P.tr = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'audio'); if (P.tr) P.tr.direction = 'sendrecv'; applyOne(P); }
        for (const c of P.queue.splice(0)) await pc.addIceCandidate(c).catch(() => { });
        if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); socket.emit('vc:signal', { to: from, data: { sdp: pc.localDescription } }); }
      } else if (data.candidate) { if (P.remote) await pc.addIceCandidate(data.candidate).catch(() => { }); else P.queue.push(data.candidate); }
    } catch { }
  });
  socket.on('vc:talk', ({ id, on }) => { if (on) talking.add(id); else talking.delete(id); onChange(); });

  async function ensureMic() {
    if (track && track.readyState === 'live') return true;
    try {
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }; if (settings.micId) audio.deviceId = { exact: settings.micId };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      track = stream.getAudioTracks()[0]; track.enabled = false; refreshDevices(); return true;
    } catch (e) {
      stream = track = null; onError?.(e && e.name === 'NotAllowedError' ? 'Няма разрешение за микрофона' : 'Микрофонът не е достъпен'); return false;
    }
  }
  async function setPtt(down) {
    if (!settings.voice) return;
    if (down && !ptt) {
      ptt = true; if (!(await ensureMic()) || !ptt) { ptt = false; return; }
      track.enabled = true; applyPolicy(); socket.emit('vc:talk', true); talking.add(getMyId()); onChange();
    } else if (!down && ptt) {
      ptt = false; if (track) track.enabled = false; socket.emit('vc:talk', false); talking.delete(getMyId()); onChange();
    }
  }
  function setMic(id) { settings.micId = id || ''; if (stream) stream.getTracks().forEach(t => t.stop()); stream = track = null; for (const P of peers.values()) P.sent = null; applyPolicy(); }
  async function refreshDevices() {
    const sel = document.querySelector('#setMic'); if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      sel.textContent = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'По подразбиране'; sel.append(o0);
      for (const d of devs) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Микрофон'; sel.append(o); }
      sel.value = settings.micId || '';
    } catch { }
  }
  return {
    sync, closeAll, setPtt, applyPolicy, setMic, refreshDevices, _peers: peers,
    isTalking: id => talking.has(id), talkers: () => [...talking],
    isMuted: id => muted.has(nameOf(id)),
    toggleMute: id => { const n = nameOf(id); if (!n) return; if (muted.has(n)) muted.delete(n); else muted.add(n); saveMuted(); applyPolicy(); },
    active: () => ptt,
    // получени аудио байтове по връзка (за диагностика)
    stats: async () => { const out = []; for (const [id, P] of peers) (await P.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') out.push({ id, bytes: r.bytesReceived, packets: r.packetsReceived }); }); return out; },
    peerStates: () => [...peers].map(([id, P]) => [id, P.pc.connectionState, P.pc.iceConnectionState, !!P.audio]),
  };
}
