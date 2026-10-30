const svg = (body) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>`)}`;

export const CHECK_EMOJI = svg(
  '<circle cx="12" cy="12" r="11" fill="#2e9e5b"/><path d="M6.5 12.5l3.8 3.8 7.2-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
);

export const SMILE_EMOJI = svg(
  '<circle cx="12" cy="12" r="11" fill="#ffcb47"/><circle cx="8.5" cy="9.5" r="1.5" fill="#553"/><circle cx="15.5" cy="9.5" r="1.5" fill="#553"/><path d="M7 14.5c1.2 2.2 3 3 5 3s3.8-.8 5-3" fill="none" stroke="#553" stroke-width="1.6" stroke-linecap="round"/>',
);
