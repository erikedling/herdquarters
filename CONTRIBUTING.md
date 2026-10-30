# Contributing

Thanks for wanting to help with Herdquarters. Bug reports, ideas and pull
requests are all welcome.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on
the approach before you spend time on it.

## Set up

You need macOS, Node.js 22 or newer and [herdr](https://herdr.dev).

```sh
git clone https://github.com/erikedling/herdquarters.git
cd herdquarters
npm install
npm test
OFFICE_FIXTURE=1 npm start  # a fake office, no herdr or agents needed
```

## Pull requests

- Keep each PR to one change, and explain what it does and why.
- Add or update tests for behaviour changes, and make sure `npm test` passes.
- For UI changes, add a screenshot.
- If you change a scene in `renderer/scenes.js`, run `npm run art` to update
  the README pictures.

PRs are squash-merged, so the PR title becomes the commit message on `main`.
Write it as a short description of the change.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
