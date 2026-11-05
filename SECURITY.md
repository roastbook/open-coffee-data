# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's [private vulnerability reporting](https://github.com/Roastbook/open-coffee-data/security/advisories/new). Do not open a public issue.

Relevant reports include:

- a way to get data past validation that the rules forbid (for example a deny-listed source, an unlicensed image or a deleted id);
- script injection or other flaws in the Data Explorer at https://data.roastbook.coffee/;
- weaknesses in the CI workflows or the Sourcing agent, such as prompt injection from crawled pages leading to changes outside `datasets/coffee-places/**` and `assets/**`;
- leaked credentials.

We aim to acknowledge reports within five working days and to agree on a disclosure date with you.

## Personal data

The dataset must not contain data about natural persons. Operators are recorded only when they are legal entities. If you find personal data, report it the same way or email data@roastbook.coffee; we remove it from the current data at once.
