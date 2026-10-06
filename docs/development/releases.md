# Publishing images

Container publishing follows two channels: `nightly` for selected development
builds and `latest` for manually published releases. Both publish Linux amd64
and arm64 images to `ghcr.io/voc0der/reddont`, plus Docker Hub when the
`DOCKER_USERNAME` and `DOCKER_PASSWORD` repository secrets are configured.

## Publish a nightly

Add the repository's **nightly** label to a pull request before merging it
into `main`. Once merged, `nightly-on-merge` dispatches **publish docker image**
on `main`. This builds the current main revision and updates these tags:

- `nightly`
- `nightly-YYYY-MM-DD`, using the UTC build date
- `sha-<short commit>`, identifying the revision being built

Closing an unmerged pull request, merging without the label, or pushing commits
directly does not publish an image. There is no scheduled container build.
Adding the label after a merge does not trigger a build.

To publish a nightly manually, open **Actions > publish docker image > Run
workflow**, select `main`, leave **channel** set to `nightly`, and leave
**version** empty. The CLI equivalent is:

```sh
gh workflow run publish-docker.yml --repo voc0der/reddont --ref main \
  -f channel=nightly
```

Nightly builds never update `latest` or a release version tag.

## Publish a release

Open **Actions > publish docker image > Run workflow**, select `main`, choose
**channel: release**, and enter the release **version**, such as `0.1.1`.
Use a stable `X.Y.Z` version without a `v` prefix or prerelease suffix.

```sh
gh workflow run publish-docker.yml --repo voc0der/reddont --ref main \
  -f channel=release -f version=0.1.1
```

This publishes the selected main revision as both `:0.1.1` and `:latest`.
It leaves all nightly tags unchanged. The version input controls the container
tag and OCI version label; the workflow does not bump source versions, create
a Git tag, or create a GitHub Release. Keep `package.json` and `flake.nix`
versions in sync when preparing a new application version.

Publishing runs from branches other than `main` are skipped. Builds within
each channel run one at a time. Check the workflow result before announcing
a release; image labels include the source revision for traceability.

## Validate workflow changes

Run the workflow linter, then validate and build the container as described in
[local development](index.md#making-changes):

```sh
actionlint .github/workflows/publish-docker.yml .github/workflows/nightly-on-merge.yml
```

Local validation does not publish images. A manual workflow run does publish
images, so use it when a new build is intended.
