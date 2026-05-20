# Security Policy

## Supported versions

Only the latest released version of IStart-Note-AI receives fixes. Please make sure you are on the latest release before reporting an issue.

| Version | Supported |
| --- | --- |
| latest release | yes |
| anything older | no |

## Reporting a vulnerability

If you believe you have found a security issue, please **do not** open a public GitHub issue. Instead:

1. Use GitHub's [private vulnerability reporting](https://github.com/yan-istart/IStart-Note-AI-Plugin/security/advisories/new) for this repository.
2. Provide a clear description of the issue, the affected version, and reproduction steps.
3. Allow up to 14 days for an initial response.

If GitHub private reporting is unavailable, open an issue with the title "Security issue — please contact me" and avoid technical details. A maintainer will reach out for a private channel.

## Scope

In scope:

- Code inside this repository (the plugin itself).
- Data flow as documented in [PRIVACY.md](./PRIVACY.md).

Out of scope:

- Vulnerabilities in DeepSeek, Baidu Pan, or any other third-party service.
- Issues caused by user-modified builds or third-party forks.
- Theoretical attacks against any TLS endpoint that does not affect this plugin specifically.

## Disclosure

Once a fix is shipped, the advisory will be published with credit to the reporter (unless anonymity is requested). Please coordinate before public disclosure to give users time to upgrade.
