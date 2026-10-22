const $ = (id) => document.getElementById(id);

function message(el, text, kind = 'error') {
  el.textContent = text;
  el.className = `msg ${kind}`;
  el.hidden = !text;
}

function pick(which) {
  $('pick-server').classList.toggle('on', which === 'server');
  $('pick-client').classList.toggle('on', which === 'client');
  $('server-form').hidden = which !== 'server';
  $('client-form').hidden = which !== 'client';
  (which === 'server' ? ($('new-admin').hidden ? $('server-go') : $('admin-email')) : $('server-address')).focus();
}

window.sdm.info().then((info) => {
  $('new-admin').hidden = info.hasLocalData;
  $('existing-data').hidden = !info.hasLocalData;
  $('server-address').value = info.clientUrl;
  if (info.uat) {
    document.title = `${info.appName} - Setup`;
    document.querySelector('.brand strong').textContent = info.appName;
    $('uat-note').hidden = false;
  }
  $('port-hint').textContent = `The app uses port ${info.defaultPort} unless you add another, e.g. 192.168.1.20:${info.defaultPort}.`;
});

$('pick-server').addEventListener('click', () => pick('server'));
$('pick-client').addEventListener('click', () => pick('client'));

$('server-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('server-msg');
  message(msg, '');
  const admin = { email: $('admin-email').value, password: $('admin-pass').value };
  if (!$('new-admin').hidden && admin.password !== $('admin-pass2').value) {
    message(msg, 'The two passwords do not match.');
    return;
  }
  $('server-go').disabled = true;
  $('server-progress').textContent = 'Setting up the database. This takes up to a minute the first time...';
  const res = await window.sdm.setupServer(admin);
  if (!res.ok) {
    $('server-go').disabled = false;
    $('server-progress').textContent = '';
    message(msg, res.message);
  }
});

$('client-test').addEventListener('click', async () => {
  const res = await window.sdm.testServer($('server-address').value);
  message($('client-msg'), res.ok ? `Connected: Security Deposit & Rent Management is running at ${res.url}.` : res.message, res.ok ? 'ok' : 'error');
});

$('client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('client-go').disabled = true;
  const res = await window.sdm.setupClient($('server-address').value);
  if (!res.ok) {
    $('client-go').disabled = false;
    message($('client-msg'), res.message);
  }
});
