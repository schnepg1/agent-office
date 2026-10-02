export {};

const form = document.getElementById('form') as HTMLFormElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const submit = document.getElementById('submit') as HTMLButtonElement;
const error = document.getElementById('error') as HTMLParagraphElement;
const sub = document.getElementById('sub') as HTMLParagraphElement;

// The token stays in the fragment: it is never sent in an HTTP request or a server access log.
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? location.hash.slice(1);
history.replaceState(null, '', location.pathname);

if (!token) {
  sub.textContent = 'This invitation link is missing its code. Ask your host to send the whole link again.';
  form.hidden = true;
} else {
  try {
    nameInput.value = localStorage.getItem('agent-office.guest-name') ?? '';
  } catch {
    // Storage can be disabled; a name can still be entered here.
  }
  nameInput.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  const name = nameInput.value.trim();
  if (!name) {
    error.textContent = 'Enter the name your host will see.';
    submit.disabled = false;
    nameInput.focus();
    return;
  }
  try {
    const response = await fetch('/api/guest/enter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      error.textContent = body.error ?? 'This invitation has expired or is no longer available.';
      return;
    }
    try {
      localStorage.setItem('agent-office.guest-name', name);
    } catch {
      // Storage can be disabled.
    }
    location.replace('/');
  } catch {
    error.textContent = 'The office could not be reached. Try again in a moment.';
  } finally {
    submit.disabled = false;
  }
});
