/**
 * Wait until injected stylesheets (e.g. tailwind.css) are parsed before first paint.
 * Prevents FOUC when BYOUI loads CSS as a separate async asset on ServiceNow instances.
 */
export function waitForStylesheets(timeoutMs = 5000): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const check = () => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
      const pending = links.filter(link => {
        try {
          return !link.sheet;
        } catch {
          // Cross-origin stylesheets may throw; treat as loaded.
          return false;
        }
      });

      if (pending.length === 0) {
        finish();
        return;
      }

      let remaining = pending.length;
      const onDone = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };

      pending.forEach(link => {
        link.addEventListener('load', onDone, { once: true });
        link.addEventListener('error', onDone, { once: true });
      });
    };

    // Side-effect CSS imports may inject <link> tags on the next frame.
    requestAnimationFrame(check);
    setTimeout(finish, timeoutMs);
  });
}
