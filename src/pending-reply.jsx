import React, { useEffect, useState } from 'react';

export default function PendingReply({ startedAt, hasDocument }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <p className="working" role="status"><span className="reply-pulse" aria-hidden="true"/>{hasDocument ? 'Reviewing your memo' : 'Preparing a reply'}… <span className="reply-elapsed" aria-hidden="true">{elapsed > 0 ? `${elapsed}s` : ''}</span></p>;
}
