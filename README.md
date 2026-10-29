# درع الكود · Alcode Shield

منصة خاصة (مؤسسة الكود) لفحص أمان المواقع المملوكة بشكل سلبي خفيف، مع شرح بالذكاء الاصطناعي، وحماية الملكية الفكرية، وفحص انكشاف البيانات الشخصية لصاحب الحساب.

Private, passive website-security scanner for **verified, owned sites only** + IP-protection and self data-exposure tools.

- Frontend: static PWA (this repo, GitHub Pages). No keys or data in the repo.
- Backend: Supabase Edge Function `shield` (proxy, service role server-side only) + Postgres with RLS (anon denied).
- Scans are non-intrusive: TLS handshake metadata, response headers, DNS over HTTPS, a few GET requests for well-known exposed files (robots.txt respected), JS library versions vs OSV. No exploitation, brute force, fuzzing or DoS.
- Ownership verification: DNS TXT `_alcode-verify.<domain>` or `/.well-known/alcode-verify-<token>.txt`.

Fonts: IBM Plex Sans Arabic (OFL). Icons: Tabler Icons (MIT).
