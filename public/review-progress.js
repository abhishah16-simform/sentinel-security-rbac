// An Access Review's progress as a bar: certified, revoked and auto-revoked segments, with the rest
// (pending) left empty. Shared by the review list and the review page.
(function () {
  const SEGMENTS = [
    ['certified', 'ok', 'Certified'],
    ['revoked', 'bad', 'Revoked'],
    ['autoRevoked', 'warn', 'Auto-revoked'],
  ];

  function bar(progress) {
    const track = document.createElement('div');
    track.className = 'progress-bar';
    track.setAttribute('role', 'img');
    const parts = SEGMENTS.map(function (segment) {
      return progress[segment[0]] + ' ' + segment[2].toLowerCase();
    });
    parts.push(progress.pending + ' pending');
    track.setAttribute('aria-label', parts.join(', '));
    track.title = parts.join(' · ');
    if (progress.total === 0) return track;
    SEGMENTS.forEach(function (segment) {
      const count = progress[segment[0]];
      if (!count) return;
      const fill = document.createElement('span');
      fill.className = segment[1];
      fill.style.width = (count / progress.total) * 100 + '%';
      track.append(fill);
    });
    return track;
  }

  window.ReviewProgress = { bar: bar };
})();
