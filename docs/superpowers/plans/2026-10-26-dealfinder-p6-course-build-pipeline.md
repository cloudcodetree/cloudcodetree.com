# DealFinder Plan 6: Course Lesson-Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every lesson's code, quoted output and screenshots come from the companion repo at that lesson's step. Tooling and CI fail on drift. The pipeline is proven end to end on Part 1.

**Architecture:** The companion gets an orphan-rooted, linear `course` branch with exactly one `step-NN:` commit per lesson. Stdlib-only Python tools in `course/tools/` verify that chain, re-create tags from it, capture outputs and run learner checkpoints, and a CI matrix runs every step commit. The site never reads the companion at build time: a sync script copies the snippets and outputs lessons use into one committed file, which a remark plugin reads offline. A Playwright shooter regenerates screenshots from per-step manifests, and changes land as a PR the owner approves.

**Tech Stack:** Companion: Python 3.11 stdlib (`tomllib`, `subprocess`, `difflib`), pytest, GNU make, GitHub Actions. Site: Node 22 with its existing `@next/mdx` 15.5.25, `sharp`, `@playwright/test` and vitest. Lint only: Docker image `rhysd/actionlint:1.7.7`.

**Spec:** `docs/superpowers/specs/2026-10-25-dealfinder-launch-and-course-design.md` §7.1, §7.1a, §7.1b, G7, G8.
**Contracts:** `docs/superpowers/plans/2026-10-26-dealfinder-launch-contracts.md`.
**Plan 1:** `docs/superpowers/plans/2026-10-25-dealfinder-p1-identity-and-data.md`.

**Repos and branches:**
- Companion `~/Development/tutorial-dealfinder`: tooling goes on `feat/launch-p6-pipeline`, with a PR to `main`. The pilot adds a new branch, `course`.
- Site `~/Development/cloudcodetree.com`: `feat/deals-course-pipeline`, from `origin/main`.

**Plan sequence:** Plans 1-5 launch the product. **Plan 6 is this plan.** Plan 7 re-grounds the other 36 lessons, builds their steps and adds three new lessons. Plan 8 is the launch.

## Release model (implements spec §7.1a)

| Phase | `main` | `course` | Tags |
|---|---|---|---|
| Before release | The product's source of truth. Plans 1-5 land here, and production deploys from it. | A working branch, rebuilt freely. Pushing it, including `--force-with-lease`, is routine. | Remote `step-*` tags stay put. The site pins step commits by SHA, so it never needs tags. |
| At release | Replaced by `course`. The old `main` survives as tag `archive/pre-course-v1`. | Its last step's tree equals the old `main` tree, which `release-check` proves. | `retag --apply --prune --push` moves every `step-NN`. `course-v1` marks the last step. |
| After release | Post-release work lands as ordinary commits after the last step. | Frozen. | Frozen. `retag` refuses while `course-v1` exists. A v2 picks its own tag namespace. |

- A product bug found while building steps is fixed on `main` first, by PR. It is then folded into its step: `git commit --fixup=<step sha>` on `course`, then `git rebase --autosquash --root` (Git 2.44+ needs no editor).
- Moving any remote `step-*` tag, pushing `course-v1` and replacing `main` each need an explicit owner go, asked as "reply 'you do it'".

## Global Constraints

**Step history**
- Step commit subjects match `^step-(\d{2}): .+$`. Numbers run from `01` with no gaps, and step NN is lesson Part NN.
- `course` is orphan-rooted and linear. Every commit except the root has exactly one parent, and every commit is a step commit.
- Every step commit adds `course/steps/NN.toml` with `id = "NN"` and `lesson = "<slug>"`. A concept lesson's step may add only that file.
- Tags are annotated. `step-NN` points at the step commit and carries its subject as the message.

**Anchors and includes**
- Anchor markers match `^\s*(#|//|--|<!--|/\*)\s*ANCHOR(_END)?:\s*([a-z0-9-]+)`. A name is unique in its file. Markers never appear in included text.
- A lesson fence opts in with meta `include="<path>[#<anchor>]"` or `output="<name>"`, plus an optional `step="NN"`. Its body is empty.
- The site build never uses the network or the companion. The plugin reads only `content/course/snippets.json`.

**Captures**
- Captures run in a clean env: `TZ=UTC`, `LC_ALL=C.UTF-8`, `PYTHONHASHSEED=0`, `COLUMNS=100`, `NO_COLOR=1`, `DEALFINDER_ENABLE_PAID_SOURCES=0`, no API keys, and `DATABASE_URL` only when the step sets `needs_db = true`.
- Anything that needs a network, a GPU or a key is `manual = true`.

**Dependencies and workflows**
- Neither repo gains a new runtime dependency. The companion tools are stdlib only. Node never parses TOML, it calls `course/tools/steps.py … --json` instead.
- No workflow added here has a `schedule:` trigger (spec §6.5).
- `run:` blocks never interpolate `${{ github.event.* }}`, `${{ inputs.* }}`, `${{ matrix.* }}` or `${{ github.head_ref }}`. Values pass through `env:` (spec §6.8).

**Scope and housekeeping**
- The only lesson file edited is `app/tutorials/(article)/dealfinder-part-01/page.draft.mdx`. It stays `draft: true`, and `RELEASED_TUTORIAL_SERIES` is not edited.
- The 38 existing remote `step-*` tags are not touched.
- Ruff rules stay `E4, E7, E9, F`. The site's `pnpm run lint` and `pnpm test` stay green.
- After any local production build, run `rm -rf out` and restart dev.

## Review Focus

1. **Broken anchors:** an unclosed `ANCHOR`, a duplicate name, a stray `ANCHOR_END`, or an anchor missing at that step. Each must error with the step, path, anchor and line numbers, never partial text. Pinned in Task 5 `throws on unclosed, duplicate and stray markers with line numbers`, and Task 6 `fails when an include names an anchor missing at that step`.
2. **Hand-copied code left in an include fence.** The build fails. Plain fences in the other 36 lessons render unchanged. Pinned in Task 5 `rejects an include fence that still has a body` and `leaves plain fences untouched`.
3. **A history that is not a clean chain:** a merge, a gap, a duplicate number, a non-step commit, or a step without its manifest. `verify` lists every problem and `retag` changes no tag. Pinned in Task 1 `test_verify_rejects_merge`, `test_verify_rejects_gap_and_duplicate`, `test_verify_rejects_non_step_commit` and `test_verify_requires_step_manifest`, and in Task 2 `test_retag_is_all_or_nothing`.
4. **Normalization hiding a real change.** Durations differ between runs, but `6 passed` becoming `5 passed, 1 failed` fails the check. Pinned in Task 3 `test_check_ignores_durations` and `test_check_fails_on_real_change`.
5. **Screenshot churn.** An unchanged screen with antialiasing noise is not rewritten. A real change is. Pinned in Task 7 `ignores per-pixel noise under the tolerance` and `detects a changed region over 0.1% of pixels`.

---

### Task 1: Step manifests and chain verification (companion)

**Files:**
- Create: `course/tools/steps.py`, `course/README.md`, `tests/course/__init__.py`, `tests/course/conftest.py`
- Test: `tests/course/test_steps.py`

**Interfaces:**
- Produces:
  - **Manifest `course/steps/NN.toml`.** Unknown keys are an error.
    - Top level: `id` (`"NN"`), `lesson` (slug), `title`, `needs_db` (default false), `setup` (shell commands run before tests and captures), `tests` (pytest paths).
    - `[[capture]]`: `name` (`[a-z0-9-]+`), `cmd` (required unless manual), `manual` with `reason` and `captured` (`YYYY-MM-DD`, both required when manual), `normalize` (list of `{pattern, replace}`), `env`, `timeout_s` (300), `expect_exit` (0).
    - `[[shot]]`: `name` (`[a-z0-9-]+`), `route` (path plus query), `ready` (a selector that must be visible), `highlight` and `mask` (selector lists), `viewport = {width, height}` (1280×800), `full_page` (false).
  - **Types.** `ManifestError(ValueError)`, and `ChainError(Exception)` with `.problems: list[str]`. Frozen dataclasses `Capture`, `Shot` and `StepManifest` mirror the manifest. `StepCommit(id, sha, subject, manifest)`.
  - **Functions.**
    - `load_manifest(path) -> StepManifest` and `load_manifest_text(text, where) -> StepManifest`.
    - `chain(repo: Path, branch="course") -> list[StepCommit]` raises `ChainError`. It reads `git log --reverse --format=%H%x00%P%x00%s <branch>` and each `git show <sha>:course/steps/NN.toml`.
    - `verify(repo, branch="course") -> list[str]` returns every problem in one pass, numbered by commit position.
  - **CLI `python course/tools/steps.py <cmd> [--repo .] [--branch course]`.**
    - `verify` prints `✓ N steps, linear` or the problems, and exits 1 on problems.
    - `matrix --json` prints `[{"id","sha","lesson","subject","needs_db"}]`.
    - `manifest NN --json` prints the working tree's `course/steps/NN.toml` as JSON.
- **Fixture `git_repo(tmp_path)`.** It runs `git init -b course` with a fixed author and date, so SHAs are reproducible, and puts `course/tools` on `sys.path`. Helpers: `.path`, `.step(nn, lesson=..., files=None, subject=None)` (commits `course/steps/NN.toml` plus `files`), `.commit(subject, files)`, `.merge(branch)`, `.git(*args) -> str`.

- [ ] **Step 1: Write the failing tests** in `tests/course/test_steps.py`.

```python
def test_verify_accepts_linear_chain(git_repo):
    git_repo.step("01", lesson="dealfinder-part-01"); git_repo.step("02", lesson="dealfinder-part-02")
    assert steps.verify(git_repo.path) == [] and [s.id for s in steps.chain(git_repo.path)] == ["01", "02"]

def test_verify_rejects_merge(git_repo):
    git_repo.step("01", lesson="a"); git_repo.git("switch", "-c", "side"); git_repo.commit("side work", {"x": "1"})
    git_repo.git("switch", "course"); git_repo.step("02", lesson="b"); git_repo.merge("side")
    assert any("merge commit" in p for p in steps.verify(git_repo.path))

@pytest.mark.parametrize("ids, problem", [(["01", "03"], "commit 2: expected step-02, found step-03"),
                                          (["01", "01"], "commit 2: expected step-02, found step-01")])
def test_verify_rejects_gap_and_duplicate(git_repo, ids, problem):
    for n, i in enumerate(ids):
        git_repo.step(i, lesson=f"l{n}", files={f"f{n}.txt": str(n)})
    assert problem in steps.verify(git_repo.path)

def test_verify_rejects_non_step_commit(git_repo):
    git_repo.step("01", lesson="a"); git_repo.commit("fix typo", {"README.md": "x"})
    assert any("not a step commit: 'fix typo'" in p for p in steps.verify(git_repo.path))

def test_verify_requires_step_manifest(git_repo):
    git_repo.commit("step-01: no manifest", {"a.py": ""})
    assert "step-01 does not add course/steps/01.toml" in steps.verify(git_repo.path)

def test_manifest_rejects_unknown_keys_and_bad_captures():
    with pytest.raises(steps.ManifestError, match="unknown key 'tset'"):
        steps.load_manifest_text('id="01"\nlesson="a"\ntitle="t"\ntset=[]', "01.toml")
    with pytest.raises(steps.ManifestError, match="manual capture 'gpu' needs reason and captured"):
        steps.load_manifest_text('id="01"\nlesson="a"\ntitle="t"\n[[capture]]\nname="gpu"\nmanual=true', "01.toml")

def test_matrix_json(git_repo, capsys):
    git_repo.step("01", lesson="dealfinder-part-01")
    assert steps.main(["matrix", "--json", "--repo", str(git_repo.path)]) == 0
    row = json.loads(capsys.readouterr().out)[0]
    assert set(row) == {"id", "sha", "lesson", "subject", "needs_db"} and row["needs_db"] is False
```

- [ ] **Step 2: Run them and see them fail**

Run: `./.venv/bin/python -m pytest tests/course/test_steps.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'steps'`.

- [ ] **Step 3: Implement `course/tools/steps.py`.** Write `course/README.md` for learners, covering `git checkout step-07`, `git diff step-06 step-07` and `make check STEP=07`.

- [ ] **Step 4: Run them and see them pass**

Run: the Step 2 command, then `./.venv/bin/python -m pytest -q && ruff check .`
Expected: 8 passed. The full suite and ruff are green.

- [ ] **Step 5: Commit**

```bash
git add course/tools/steps.py course/README.md tests/course/__init__.py tests/course/conftest.py tests/course/test_steps.py
git commit -m "feat(course): step manifests and linear step-chain verification"
```

---

### Task 2: Tags from step commits, with the release guard (companion)

**Files:**
- Modify: `course/tools/steps.py`
- Create: `course/RELEASE.md`
- Test: `tests/course/test_retag.py`

**Interfaces:**
- Consumes: `chain`, `ChainError` and `git_repo` (Task 1).
- Produces:
  - **`RetagReport`**, with `create: list[(tag, sha)]`, `move: list[(tag, old, new)]`, `keep: list[str]` and `delete: list[str]`.
  - **`retag(repo, branch="course", *, prefix="step-", apply=False, prune=False, push=False, remote="origin") -> RetagReport`.** A dry run by default. `apply` writes every tag object with `git mktag`, then changes all refs in one `git update-ref --stdin` transaction. `prune` deletes `<prefix>NN` tags with no step. `push` runs one `git push --atomic --force <remote>` with every changed and deleted ref.
  - **`RetagRefused(Exception)`**, raised before any ref changes when `course-v1` exists locally or on `remote` (`git ls-remote --tags`), or when `push` is set without `apply`.
  - **`release_check(repo, branch="course", main="main") -> list[str]`** requires a clean `verify`, equal trees (`git diff --quiet <main> <branch>`), no `course-v1`, and every `step-NN` already matching the plan.
  - **CLI:** `retag [--prefix step-] [--apply] [--prune] [--push]` prints one line per tag. `release-check [--main main]` prints the problems, or the release commands, which it never runs.
- **`course/RELEASE.md`** holds the release model table and this exact sequence. Each remote change is marked "owner go: reply 'you do it'".
  1. `release-check`
  2. `git tag -a archive/pre-course-v1 origin/main -m …`, then push it
  3. `git push --force-with-lease=main origin course:main`
  4. `retag --apply --prune --push`
  5. `git tag -a course-v1 <last step sha> -m …`, then push it

- [ ] **Step 1: Write the failing tests.** The `git_repo_with_origin` fixture adds a bare repo in `tmp_path` as `origin`.

```python
def test_retag_dry_run_changes_nothing(git_repo):
    git_repo.step("01", lesson="a")
    assert steps.retag(git_repo.path).create == [("step-01", git_repo.git("rev-parse", "course").strip())]
    assert git_repo.git("tag", "--list") == ""

def test_retag_apply_creates_annotated_tags(git_repo):
    git_repo.step("01", lesson="a", subject="step-01: Data layer"); steps.retag(git_repo.path, apply=True)
    assert git_repo.git("cat-file", "-t", "step-01").strip() == "tag"
    assert git_repo.git("tag", "-l", "--format=%(contents:subject)", "step-01").strip() == "step-01: Data layer"

def test_retag_moves_an_existing_tag(git_repo):
    git_repo.step("01", lesson="a"); steps.retag(git_repo.path, apply=True)
    git_repo.git("commit", "--amend", "-m", "step-01: renamed")
    assert [m[0] for m in steps.retag(git_repo.path, apply=True).move] == ["step-01"]

def test_retag_is_all_or_nothing(git_repo):
    git_repo.step("01", lesson="a"); git_repo.commit("stray", {"x": "1"})
    with pytest.raises(steps.ChainError):
        steps.retag(git_repo.path, apply=True)
    assert git_repo.git("tag", "--list") == ""

def test_prune_only_with_flag(git_repo):
    git_repo.step("01", lesson="a"); git_repo.git("tag", "-a", "step-02", "-m", "old", "HEAD")
    assert steps.retag(git_repo.path, apply=True).delete == []
    assert steps.retag(git_repo.path, apply=True, prune=True).delete == ["step-02"]

def test_retag_refuses_after_release(git_repo):
    git_repo.step("01", lesson="a"); git_repo.git("tag", "-a", "course-v1", "-m", "v1", "HEAD")
    with pytest.raises(steps.RetagRefused, match="course-v1 exists: step tags are frozen"):
        steps.retag(git_repo.path, apply=True)

def test_push_requires_apply_and_is_atomic(git_repo_with_origin):
    r = git_repo_with_origin; r.step("01", lesson="a")
    with pytest.raises(steps.RetagRefused):
        steps.retag(r.path, push=True)
    steps.retag(r.path, apply=True, push=True)
    assert "refs/tags/step-01" in r.git("ls-remote", "--tags", "origin")

def test_release_check_requires_equal_trees(git_repo):
    git_repo.step("01", lesson="a", files={"app.py": "v1"}); git_repo.git("branch", "main")
    git_repo.git("switch", "main"); git_repo.commit("product fix", {"app.py": "v2"}); git_repo.git("switch", "course")
    assert "course tip tree differs from main" in steps.release_check(git_repo.path)
```

- [ ] **Step 2: Run them and see them fail**

Run: `./.venv/bin/python -m pytest tests/course/test_retag.py -v`
Expected: FAIL with `AttributeError: module 'steps' has no attribute 'retag'`.

- [ ] **Step 3: Implement** `retag`, `RetagRefused`, `release_check`, both subcommands and `course/RELEASE.md`.

- [ ] **Step 4: Run them and see them pass**

Run: the Step 2 command, then the full suite and `ruff check .`
Expected: 8 passed. Everything is green.

- [ ] **Step 5: Commit**

```bash
git add course/tools/steps.py course/RELEASE.md tests/course/test_retag.py
git commit -m "feat(course): atomic retag from step commits; frozen after course-v1; release check"
```

---

### Task 3: Captured outputs and `make check STEP=NN` (companion)

**Files:**
- Create: `course/tools/capture.py`, `course/tools/check.py`, `Makefile`
- Modify: `README.md`, adding one "Course checkpoints" line that points at `course/README.md`
- Test: `tests/course/test_capture.py`

**Interfaces:**
- Consumes: `load_manifest`, `StepManifest` and `Capture` (Task 1).
- Produces:
  - **Output files `course/outputs/NN/<name>.txt`.** Line 1 is `$ <cmd>`, then the normalized stdout and stderr. A manual file's line 1 is `# manual: <reason> · captured <YYYY-MM-DD>`, then the pasted output.
  - **`clean_env(manifest, base: Mapping[str, str]) -> dict[str, str]`.** It keeps only `PATH`, `HOME` and `VIRTUAL_ENV`. On top it adds the baseline from Global Constraints, then `DATABASE_URL` only when `needs_db`, then the capture's `env`.
  - **`normalize(text, rules, repo_root: Path) -> str`.** Built-ins run first, then the capture's rules: strip ANSI escapes, `in \d+(\.\d+)?s` becomes `in <t>s`, `0x[0-9a-f]{6,}` becomes `0x<addr>`, the absolute `repo_root` becomes `.`, and trailing whitespace is trimmed.
  - **`run_capture(manifest, cap, repo_root) -> str`.** It runs `bash -o pipefail -c <cmd>` with `clean_env` and `timeout=cap.timeout_s`. It raises `CaptureError` on a wrong exit code or a timeout.
  - **`capture.py NN [--check] [--repo .]`.**
    - It runs `setup`, then writes every non-manual capture. A missing manual file is an error.
    - `--check` writes nothing. It prints a unified diff per drifted file and exits 1 on drift or error.
  - **`check.py NN [--repo .]`.** It runs `setup`, then `python -m pytest -q <tests>`.
    - On a pass it prints `✓ Part NN checkpoint: <title> (<n> passed)`.
    - On a failure it prints `✗ Part NN checkpoint failed. Compare with: git diff step-NN -- <failing test paths>`.
  - **`Makefile`** (`PY ?= python`): `check` runs `$(PY) course/tools/check.py $(STEP)`, `capture` runs `capture.py $(STEP)`, `capture-check` adds `--check`. A missing `STEP` prints `usage: make check STEP=NN` and exits 2.

- [ ] **Step 1: Write the failing tests.** The `tmp_step` fixture writes `course/steps/01.toml` in `tmp_path`. Its capture prints text the test sets.

```python
def test_normalize_durations_and_paths(tmp_path):
    out = capture.normalize(f"6 passed in 0.42s\n{tmp_path}/tests/a.py  \n\x1b[32mok\x1b[0m", [], tmp_path)
    assert out == "6 passed in <t>s\n./tests/a.py\nok"

def test_check_ignores_durations(tmp_step):
    tmp_step.set_output("6 passed in 0.42s"); assert capture.main(["01"]) == 0
    tmp_step.set_output("6 passed in 1.97s"); assert capture.main(["01", "--check"]) == 0

def test_check_fails_on_real_change(tmp_step, capsys):
    tmp_step.set_output("6 passed in 0.42s"); capture.main(["01"])
    tmp_step.set_output("5 passed, 1 failed in 0.40s")
    assert capture.main(["01", "--check"]) == 1 and "-6 passed in <t>s" in capsys.readouterr().out

def test_manual_capture_skipped_but_required(tmp_step):
    tmp_step.add_manual("colab-train", reason="needs a Colab T4 GPU", captured="2026-10-20")
    assert capture.main(["01", "--check"]) == 1
    tmp_step.write_output("colab-train", "# manual: needs a Colab T4 GPU · captured 2026-10-20\nloss 0.41")
    assert capture.main(["01", "--check"]) == 0

def test_clean_env_drops_keys(tmp_step):
    env = capture.clean_env(tmp_step.manifest, {"PATH": "/bin", "BESTBUY_API_KEY": "k", "DATABASE_URL": "x"})
    assert "BESTBUY_API_KEY" not in env and "DATABASE_URL" not in env and env["TZ"] == "UTC"

def test_exit_code_mismatch_fails(tmp_step):
    tmp_step.set_cmd("exit 3"); assert capture.main(["01"]) == 1

def test_check_cli_reports_checkpoint(tmp_step, capsys):
    tmp_step.add_passing_test(); assert check.main(["01"]) == 0
    assert "✓ Part 01 checkpoint:" in capsys.readouterr().out
```

- [ ] **Step 2: Run them and see them fail**

Run: `./.venv/bin/python -m pytest tests/course/test_capture.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'capture'`.

- [ ] **Step 3: Implement** `capture.py` (using `difflib.unified_diff` for drift), then `check.py`, then the `Makefile`.

- [ ] **Step 4: Run them and see them pass**

Run: the Step 2 command, then `make check`, then the full suite and ruff.
Expected: 7 passed. `make check` with no `STEP` prints the usage line and exits 2.

- [ ] **Step 5: Commit**

```bash
git add course/tools/capture.py course/tools/check.py Makefile README.md tests/course/test_capture.py
git commit -m "feat(course): captured outputs with drift check; make check STEP=NN learner checkpoints"
```

---

### Task 4: A CI job per step (companion)

**Files:**
- Create: `.github/workflows/course-steps.yml`
- Test: `tests/course/test_workflow_hygiene.py`

**Interfaces:**
- Consumes: `steps.py verify` and `matrix --json` (Task 1), and `make check` and `make capture-check` (Task 3).
- Produces: the workflow `course-steps`.
  - **Triggers and permissions.** `push` and `pull_request` on `course`, and `workflow_dispatch`. Permissions are `contents: read`.
  - **Job `plan`.** Checkout with `fetch-depth: 0`, then `python course/tools/steps.py verify`. It outputs `matrix` from `matrix --json`.
  - **Job `step`.**
    - `needs: plan`, `fail-fast: false`, matrix `include: ${{ fromJSON(needs.plan.outputs.matrix) }}`.
    - Service `db`: `pgvector/pgvector:0.7.0-pg16`, with the same env as `ci.yml`.
    - Job env: `STEP: ${{ matrix.id }}`, `NEEDS_DB: ${{ matrix.needs_db }}`.
    - Steps, in order: checkout `ref: ${{ matrix.sha }}`, setup-python 3.11 with the pip cache, `pip install -e ".[dev]"`, write `DATABASE_URL=postgresql://dealfinder:dealfinder@localhost:5432/dealfinder` to `$GITHUB_ENV` when `NEEDS_DB` is true, `python -m pytest -q`, `make check STEP="$STEP"`, `make capture-check STEP="$STEP"`.
- `test_workflow_hygiene.py` scans every `.github/workflows/*.yml` line by line, without a YAML library. It tracks `run:` blocks by their indentation.

- [ ] **Step 1: Write the failing tests**

```python
FORBIDDEN = ("${{ github.event.", "${{ inputs.", "${{ matrix.", "${{ github.head_ref")

def test_no_expression_interpolation_in_run_blocks():
    assert [f"{p.name}:{n}" for p, n, line in run_block_lines(WORKFLOWS) if any(f in line for f in FORBIDDEN)] == []

def test_no_schedule_triggers():
    assert [p.name for p in WORKFLOWS if re.search(r"^\s*schedule:", p.read_text(), re.M)] == []

def test_course_steps_workflow_reads_the_matrix():
    text = (ROOT / ".github/workflows/course-steps.yml").read_text()
    assert "fromJSON(needs.plan.outputs.matrix)" in text and "make capture-check" in text
```

- [ ] **Step 2: Run them and see them fail**

Run: `./.venv/bin/python -m pytest tests/course/test_workflow_hygiene.py -v`
Expected: FAIL on `test_course_steps_workflow_reads_the_matrix`, because the file is missing. If a hygiene test fails on a workflow from an earlier plan, fix that workflow here by moving the value into `env:`.

- [ ] **Step 3: Write the workflow** as specified.

- [ ] **Step 4: Lint and run**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7`, then `./.venv/bin/python -m pytest tests/course -q`
Expected: actionlint prints nothing, and all course tests pass. The workflow first runs for real in Task 9.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/course-steps.yml tests/course/test_workflow_hygiene.py
git commit -m "ci(course): one job per step commit on the light stack; workflow hygiene tests"
```

---

### Task 5: Anchor extraction and the remark include plugin (site)

**Files:**
- Create:
  - `scripts/lib/course-anchors.mjs` and `scripts/lib/course-anchors.test.mjs`
  - `scripts/lib/remark-course-include.mjs` and `scripts/lib/remark-course-include.test.mjs`
  - `content/course/snippets.json`, empty, in the shape below
- Modify: `next.config.js`

**Interfaces:**
- Produces:
  - **`content/course/snippets.json`.** Keys are sorted, the file ends with a newline, and a whole-file include has a key with no `#`. `manual` is `null` or `{"reason", "captured"}`.

    ```json
    {"version": 1, "repo": "https://github.com/cloudcodetree/tutorial-dealfinder", "branch": "course",
     "steps": {"01": {"sha": "<40 hex>", "lesson": "dealfinder-part-01", "subject": "step-01: …"}},
     "snippets": {"01:dealfinder/schema.py#product": {"lang": "python", "text": "…"}},
     "outputs": {"01:pytest": {"text": "…", "manual": null}}}
    ```

  - **`course-anchors.mjs`:** `ANCHOR_RE`, `CourseAnchorError`, `listAnchors(text, where) -> Map<name, {start, end}>` (validates the whole file), and `extractAnchor(text, name | null, where) -> string` (`null` means the whole file, marker lines stripped, dedented).
  - **`remark-course-include.mjs`.**
    - `parseFenceMeta(meta) -> null | {include?: {path, anchor}, output?, step?}`.
    - `lessonSlugFromPath(path) -> string | null` matches `app/tutorials/(article)/<slug>/page(.draft)?.mdx`.
    - The default export `remarkCourseInclude({snippets})` returns `(tree, file) => void`.
    - It loads the JSON once and reloads it when the mtime changes.
    - An explicit `step` wins. Otherwise it uses the step whose `lesson` is the file's slug.
    - It sets `lang` from the snippet when the fence has none.
    - It appends `Captured by hand: <reason> (<captured>).` after a manual output.
  - **`next.config.js`.** `remarkPlugins: [['remark-gfm'], ['./scripts/lib/remark-course-include.mjs', { snippets: 'content/course/snippets.json' }]]`.
    - `@next/mdx` 15.5.25 resolves the string from the project root: its `mdx-js-loader.js` calls `require.resolve(plugin, { paths: [projectRoot] })`.
    - The options stay plain JSON, for Turbopack.

- [ ] **Step 1: Write the failing tests** in vitest. Build the mdast nodes by hand, with no new dependency.

```js
// course-anchors.test.mjs
it('extracts a named region and strips nested markers', () => {
  const src = '# ANCHOR: all\nx = 1\n# ANCHOR: inner\ny = 2\n# ANCHOR_END: inner\n# ANCHOR_END: all\n';
  expect(extractAnchor(src, 'all', 'a.py')).toBe('x = 1\ny = 2');
});
it('dedents the region', () => {
  expect(extractAnchor('class A:\n    # ANCHOR: m\n    def m(self):\n        return 1\n    # ANCHOR_END: m\n', 'm', 'a.py'))
    .toBe('def m(self):\n    return 1');
});
it('throws on unclosed, duplicate and stray markers with line numbers', () => {
  expect(() => listAnchors('# ANCHOR: a\nx\n', 'a.py')).toThrow(/a\.py:1 ANCHOR 'a' is never closed/);
  expect(() => listAnchors('# ANCHOR: a\n# ANCHOR_END: a\n# ANCHOR: a\n# ANCHOR_END: a\n', 'a.py')).toThrow(/a\.py:3 duplicate anchor 'a'/);
  expect(() => listAnchors('x\n# ANCHOR_END: b\n', 'a.py')).toThrow(/a\.py:2 ANCHOR_END 'b' has no ANCHOR/);
});
it('reads #, //, -- and <!-- --> comment leaders', () => {
  for (const [o, c] of [['# ', ''], ['// ', ''], ['-- ', ''], ['<!-- ', ' -->']])
    expect(extractAnchor(`${o}ANCHOR: q${c}\nSELECT 1\n${o}ANCHOR_END: q${c}\n`, 'q', 'f')).toBe('SELECT 1');
});

// remark-course-include.test.mjs (fixture snippets file in a tmp dir; PART01 = Part 1's MDX path)
it('fills an include fence from snippets at the lesson step', () => {
  const node = code('include="dealfinder/schema.py#product"');
  run(tree(node), PART01); expect(node.value).toBe('class Product(BaseModel):\n    id: str');
});
it('honours an explicit step override', () => { /* meta adds step="02"; expect the step 02 fixture text */ });
it('throws naming the lesson, step, path and anchor when a key is missing', () => {
  expect(() => run(tree(code('include="dealfinder/schema.py#nope"')), PART01))
    .toThrow(/dealfinder-part-01: step 01 has no snippet dealfinder\/schema\.py#nope.*sync-course-snippets/);
});
it('rejects an include fence that still has a body', () => {
  expect(() => run(tree({ ...code('include="dealfinder/schema.py#product"'), value: 'stale' }), PART01))
    .toThrow(/include fence must be empty/);
});
it('leaves plain fences untouched', () => {
  const plain = { type: 'code', lang: 'bash', meta: null, value: 'pytest -q' };
  run(tree(plain), PART01); expect(plain.value).toBe('pytest -q');
});
it('appends the manual-capture note after a manual output', () => { /* expect the paragraph node */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run scripts/lib/course-anchors.test.mjs scripts/lib/remark-course-include.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement** both modules, the empty snippet file and the config entry. Walk the tree with a small recursive function rather than `unist-util-visit`.

- [ ] **Step 4: Run tests, lint and a production build**

Run: the Step 2 command, then `pnpm run lint && pnpm run build && rm -rf out`
Expected: 10 passed and lint is clean. The build succeeds unchanged, because no lesson uses an include yet.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/course-anchors.mjs scripts/lib/course-anchors.test.mjs scripts/lib/remark-course-include.mjs scripts/lib/remark-course-include.test.mjs content/course/snippets.json next.config.js
git commit -m "feat(tutorials): build-time course includes by named anchor, offline from a committed snippet file"
```

---

### Task 6: Snippet sync and the drift check (site)

**Files:**
- Create: `scripts/sync-course-snippets.mjs` and `scripts/sync-course-snippets.test.mjs`
- Create: `.github/workflows/course-content.yml`
- Modify: `.gitignore`, adding `.cache/course-*`
- Modify: `CLAUDE.md`, adding one Tutorials paragraph on includes, the snippet file and both scripts

**Interfaces:**
- Consumes:
  - Task 5: the anchor and meta helpers, and the snippet file shape.
  - Companion: `steps.py matrix --json` (Task 1) and `course/outputs/NN/*.txt` (Task 3).
- Produces:
  - **`collectRefs(lessons: {slug, path, text}[]) -> Ref[]`.** It scans fences line by line.
    - `Ref = {kind: 'include' | 'output', slug, step, path?, anchor?, name?, where: '<file>:<line>'}`.
  - **`buildSnippets({refs, steps, read, strictLessons?}) -> SnippetsFile`.**
    - `read(sha, path)` returns `string | null`.
    - The function is pure. It throws `CourseSyncError` listing every problem.
  - **CLI `node scripts/sync-course-snippets.mjs [--companion <path>] [--update-lock] [--check] [--strict]`.**
    - The companion defaults to `companions/dealfinder` when that exists. Otherwise it is `git clone --filter=blob:none --no-checkout` of the public repo into `.cache/course-companion`, followed by fetching `course`.
    - `--update-lock` replaces `steps` with `matrix --json` run at the `course` tip. Without it, the committed `steps` are kept.
    - Files are read with `git show <sha>:<path>`. A manual output's header line becomes `manual`.
    - `--check` compares the result with the committed file. It exits 1 and lists the keys that differ.
    - `--strict` requires a step for every lesson in the `Become a Full-Stack AI Engineer` series, read through `scripts/lib/tutorials-data.mjs`. This is the release gate.
  - **Workflow `course-content`.**
    - Triggers: `pull_request`, and `push` to `main`. The `paths:` filter covers `content/course/**`, `app/tutorials/(article)/dealfinder-*/**` and the three course scripts.
    - It runs the three course vitest files, then `node scripts/sync-course-snippets.mjs --check`. This covers draft lessons, which a production `next build` never compiles.
    - Permissions are `contents: read`. Node 22 and pnpm 11.0.9 match `deploy.yml`.

- [ ] **Step 1: Write the failing tests**, using an in-memory `read` and fixture lessons.

```js
it('builds keys "<step>:<path>#<anchor>" from lesson fences', () => {
  expect(Object.keys(build([part01]).snippets)).toEqual(['01:dealfinder/schema.py#product']);
});
it('fails when a lesson with includes has no step in the lock', () => {
  expect(() => build([part05])).toThrow(/dealfinder-part-05 uses course includes but has no step in the lock/);
});
it('fails when an include names an anchor missing at that step', () => {
  expect(() => build([withAnchor('nope')])).toThrow(/step 01 dealfinder\/schema\.py has no anchor 'nope'/);
});
it('fails --strict when any series lesson has no step', () => {
  expect(() => build([part01], { strictLessons: ['dealfinder-part-01', 'dealfinder-part-02'] })).toThrow(/dealfinder-part-02 has no step/);
});
it('marks manual outputs with reason and date and strips the header line', () => {
  expect(build([manualLesson]).outputs['01:colab-train'])
    .toEqual({ text: 'loss 0.41', manual: { reason: 'needs a Colab T4 GPU', captured: '2026-10-20' } });
});
it('is byte-stable', () => { expect(serialize(build([part01]))).toBe(serialize(build([part01]))); });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run scripts/sync-course-snippets.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the script, keeping the functions pure and the CLI thin. Then add the workflow, the `.gitignore` line and the `CLAUDE.md` paragraph.

- [ ] **Step 4: Run it**

Run: the Step 2 command, then `node scripts/sync-course-snippets.mjs --check`, then `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 .github/workflows/course-content.yml`
Expected:
- 6 passed.
- The check prints `✓ course snippets in sync (0 steps, 0 snippets, 0 outputs)`.
- actionlint exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-course-snippets.mjs scripts/sync-course-snippets.test.mjs .github/workflows/course-content.yml .gitignore CLAUDE.md
git commit -m "feat(tutorials): sync course snippets from pinned step commits; CI drift check"
```

---

### Task 7: Screenshots from per-step manifests (site)

**Files:**
- Create: `scripts/lib/screen-diff.mjs`, `scripts/lib/screen-diff.test.mjs`, `scripts/shoot-course.mjs`, `.github/workflows/course-shots.yml`

**Interfaces:**
- Consumes: the snippet file's `steps` (Task 6), and `steps.py manifest NN --json` run inside each step's tree (Task 1).
- Produces:
  - **`screenDiffers(oldPng: Buffer | null, newPng: Buffer, {pixelTolerance = 24, maxChangedFraction = 0.001} = {}) -> Promise<boolean>`.** It decodes both with `sharp(…).ensureAlpha().raw()`. It is true when there is no old image, the sizes differ, or more than `maxChangedFraction` of pixels have a channel delta above `pixelTolerance`.
  - **`RING_CSS`** = `'[data-course-ring]{outline:3px solid #f59f00 !important;outline-offset:3px !important;border-radius:6px}'`
  - **CLI `node scripts/shoot-course.mjs --steps <01,02|all> [--companion <path>] [--port 8710]`.** Per step: add a git worktree at the locked SHA under `.cache/course-shots/NN`, create a venv with `pip install -e .`, run `setup` (`DATABASE_URL` must be present when `needs_db`), then boot `uvicorn dealfinder.serve:app --port <port>` with Task 3's clean env and wait up to 60 s for `/healthz`.
  - **Per shot:** set the viewport, `goto(route)`, wait up to 30 s for `ready`, mark the `highlight` matches with `data-course-ring`, inject `RING_CSS`, wait two animation frames, screenshot with `mask` and `fullPage`. Write `public/tutorials/screens/<lesson>/<name>.png` only when `screenDiffers`.
  - **Exit behavior.** A `finally` block stops the server and removes the worktree. The CLI prints `written`, `unchanged` or `failed` per shot, and exits 1 when any shot failed. A failed shot never replaces or deletes an existing PNG.
  - **Workflow `course-shots`.**
    - Trigger: `workflow_dispatch` with input `steps` (default `all`), passed to the run as `env: STEPS`.
    - Runner: `ubuntu-24.04`, with the pgvector service, Node 22, pnpm 11.0.9 and Python 3.11.
    - Steps: `pnpm install --frozen-lockfile`, then `pnpm exec playwright install --with-deps chromium`, then the shooter.
    - If `git status --porcelain -- public/tutorials/screens` is not empty, it pushes `course-shots/$GITHUB_RUN_ID` and runs `gh pr create`, titled `course: regenerated screenshots (steps $STEPS)` and listing the written shots. GitHub shows PNG diffs in the PR, and the owner approves there.
    - Permissions are `contents: write` and `pull-requests: write`. A PR opened by `GITHUB_TOKEN` starts no other workflow. That is accepted, because these PRs change only images.

- [ ] **Step 1: Write the failing tests**, with images made in memory by `sharp`.

```js
it('identical images do not differ', async () => { expect(await screenDiffers(a, a)).toBe(false); });
it('ignores per-pixel noise under the tolerance', async () => { expect(await screenDiffers(a, noisy(a, 10))).toBe(false); });
it('detects a changed region over 0.1% of pixels', async () => { expect(await screenDiffers(a, withRect(a, 40, 40))).toBe(true); });
it('a size change always differs', async () => { expect(await screenDiffers(a, resized(a))).toBe(true); });
it('a missing old image always differs', async () => { expect(await screenDiffers(null, a)).toBe(true); });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run scripts/lib/screen-diff.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `screen-diff.mjs`, then `shoot-course.mjs` (importing `chromium` from `@playwright/test`), then the workflow.

- [ ] **Step 4: Run tests and lint**

Run: the Step 2 command, then `pnpm run lint`, then actionlint on `course-shots.yml`.
Expected: 5 passed and everything is clean. The shooter runs for real in Task 9.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/screen-diff.mjs scripts/lib/screen-diff.test.mjs scripts/shoot-course.mjs .github/workflows/course-shots.yml
git commit -m "feat(tutorials): screenshots from per-step manifests, rewritten only on real change, via PR"
```

---

### Task 8: Pilot prep: Part 1 anchors, a snapshot lab mode and step 01's manifest (companion)

**Files:**
- Modify (anchor comments only): `dealfinder/schema.py`, `features.py`, `ingest.py`, `snapshot.py`, `live_sources.py`
- Modify: `dealfinder/serve.py` (`GET /snapshot`), and Plan 4's lab: the `snapshot` mode in `dealfinder/static/lab/index.html` and `lab.js`, a `"snapshot": {"part": 1, "slug": "dealfinder-part-01", "live": false}` entry in `dealfinder/static/lab/lessons.json`, and `"snapshot"` added to `LAB_MODES` in `tests/test_lab.py`
- Create: `course/steps/01.toml`, and `course/outputs/01/pytest.txt`, which is generated
- Test: `tests/test_serve.py`

**Interfaces:**
- Consumes:
  - **From Plan 4,** as requested contract additions: the lab works when the backend serves it directly. It has one registry entry per mode, and each mode renders `data-mode="<id>"` in the `/lab` HTML. It reads `?mode=<id>&q=<query>` on load. The active mode's container gets `data-ready="true"` when rendering finishes.
  - **From Plan 2:** the snapshot without `image_url`.
  - **From Task 3:** `make capture` and `make check`.
- Produces:
  - **Anchors,** one per Part 1 fence whose first line is `# dealfinder/<file>.py`: `schema.py#product`, `features.py#title-brand`, `ingest.py#dedup`, `snapshot.py#load-snapshot`, `live_sources.py#rapidapi-source`.
  - **`GET /snapshot?q=&limit=50`** returns `{"total": 270, "retailer_polluted": 154, "count": int, "rows": [{"id", "title", "raw_brand", "brand", "price", "source", "dedup_key"}]}`. `brand` comes from `features.title_brand`, `retailer_polluted` uses the rule `tests/test_part01.py` pins, `q` is a case-insensitive title filter, and rows carry no `image_url`.
  - **Lab mode `snapshot`, titled "Snapshot (Part 1)".** It has a keyword box and a table of raw against extracted brand. Rows where the two differ carry `data-row-polluted="true"`.
  - **`course/steps/01.toml`:**

    ```toml
    id = "01"
    lesson = "dealfinder-part-01"
    title = "Data layer, normalization & the snapshot"
    tests = ["tests/test_part01.py", "tests/test_schema.py", "tests/test_snapshot.py", "tests/test_ingest.py"]
    [[capture]]
    name = "pytest"
    cmd = "python -m pytest tests/test_part01.py -v -p no:cacheprovider"
    [[shot]]
    name = "snapshot-brand-audit"
    route = "/lab?mode=snapshot&q=sony"
    ready = "[data-mode='snapshot'][data-ready='true']"
    highlight = ["[data-row-polluted='true'] .raw-brand"]
    viewport = { width = 1280, height = 860 }
    ```

- [ ] **Step 1: Write the failing tests**

```python
def test_snapshot_route_counts():
    j = client.get("/snapshot").json()
    assert (j["total"], j["retailer_polluted"]) == (270, 154) and all("image_url" not in r for r in j["rows"])

def test_snapshot_route_filters_case_insensitively():
    rows = client.get("/snapshot", params={"q": "SONY", "limit": 500}).json()["rows"]
    assert rows and all("sony" in r["title"].lower() for r in rows)

def test_lab_registers_snapshot_mode():
    assert 'data-mode="snapshot"' in client.get("/lab").text
```

- [ ] **Step 2: Run them and see them fail**

Run: `./.venv/bin/python -m pytest tests/test_serve.py -k snapshot -v`
Expected: FAIL with a 404 on `/snapshot`.

- [ ] **Step 3: Implement** the route, the mode, the anchors and `course/steps/01.toml`.

- [ ] **Step 4: Generate and check step 01's artifacts**

Run: `make capture STEP=01 && make capture-check STEP=01 && make check STEP=01`, then the full suite and ruff.
Expected:
- Line 1 of `course/outputs/01/pytest.txt` is `$ python -m pytest tests/test_part01.py -v -p no:cacheprovider`, followed by the real result.
- The capture check passes.
- `make check STEP=01` prints `✓ Part 01 checkpoint`.

- [ ] **Step 5: See it in the browser.** Start the app and open `http://127.0.0.1:8000/lab?mode=snapshot&q=sony`. Confirm the ready attribute is set and the polluted rows are marked. Take a chrome-devtools screenshot, per the standing demo rule.

- [ ] **Step 6: Commit, push and open the PR.** Add the Plan 4 registry files by explicit path as well. Merging needs the owner's explicit go.

```bash
git add dealfinder/schema.py dealfinder/features.py dealfinder/ingest.py dealfinder/snapshot.py dealfinder/live_sources.py dealfinder/serve.py course/steps/01.toml course/outputs/01/pytest.txt tests/test_serve.py dealfinder/static/lab/index.html dealfinder/static/lab/lab.js dealfinder/static/lab/lessons.json tests/test_lab.py
git commit -m "feat(course): Part 1 anchors, snapshot lab mode and the step 01 manifest"
git push -u origin feat/launch-p6-pipeline && gh pr create --fill
```

---

### Task 9: Pilot: build `step-01` and run the whole pipeline on Part 1

**Files:**
- Companion: a new orphan branch `course` with one commit, `step-01: Data layer, normalization & the snapshot`.
- Site:
  - Modify: `app/tutorials/(article)/dealfinder-part-01/page.draft.mdx`, `content/course/snippets.json`
  - Generate: `public/tutorials/screens/dealfinder-part-01/snapshot-brand-audit.png`

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces:
  - The first real step commit, which Plan 7 keeps as `step-01`.
  - A site lock that pins its SHA.
  - Part 1, the first lesson rendered from includes.

- [ ] **Step 1: Cut the step tree.** In a separate worktree, run `git switch --orphan course`. Then run `git checkout feat/launch-p6-pipeline -- <paths>` for exactly these paths:
  - **Course tooling:** `Makefile`, `course/tools/`, `course/README.md`, `course/RELEASE.md`, `course/steps/01.toml`, `course/outputs/01/`, `.github/workflows/course-steps.yml`
  - **Project files:** `pyproject.toml`, `.devcontainer/`, `.gitignore`, `README.md`, `data/snapshots/`
  - **Tests:** `tests/__init__.py`, `tests/conftest.py`, `tests/course/`, `tests/test_part01.py`, `tests/test_schema.py`, `tests/test_snapshot.py`, `tests/test_ingest.py`
  - **App code:** `dealfinder/__init__.py`, `schema.py`, `sources.py`, `live_sources.py`, `features.py`, `ingest.py`, `snapshot.py`, `serve.py`
  - **Lab:** the files in Plan 4's lab registry

- [ ] **Step 2: Trim to Part 1.** Remove what later lessons teach and keep every Task 8 anchor. `serve.py` keeps only `/healthz`, `/lab` and `/snapshot`. The lab keeps only the `snapshot` mode. `live_sources.py` keeps `_f`, `_paid_ok`, `RapidApiSource` and `ApifySource`. `features.py` keeps `title_brand` and what it needs. `pyproject.toml` and `tests/conftest.py` keep only what these files import and use.

  Run: `./.venv/bin/python -m pytest -q && make check STEP=01 && make capture-check STEP=01 && ruff check .`
  Expected: all green on the trimmed tree.

- [ ] **Step 3: Commit and verify the chain**

Run:
1. `git commit -m "step-01: Data layer, normalization & the snapshot"`
2. `python course/tools/steps.py verify`
3. `python course/tools/steps.py retag`

Expected:
- `verify` prints `✓ 1 steps, linear`.
- The `retag` dry run prints `move step-01 425d6d0 -> <new sha>` and changes nothing. No tag moves in this plan.

- [ ] **Step 4: Push `course` and watch its CI**

Run: `git push -u origin course`, then `gh run watch` on the `course-steps` run.
Expected: `plan` and `step (01)` are green.

- [ ] **Step 5: Lock the step and convert Part 1.** On the site branch:
  1. Run `node scripts/sync-course-snippets.mjs --update-lock --companion companions/dealfinder`.
  2. In Part 1, replace each fence whose first line is `# dealfinder/<file>.py` with an empty include fence for its anchor.
  3. Replace the `pytest tests/test_part01.py -v` output block with `output="pytest"`.
  4. Fix any number in the prose that the real output contradicts.
  5. Run the sync again, then `pnpm exec vitest run` and `node scripts/sync-course-snippets.mjs --check`.

  Expected:
  - The lock pins step `01` to the pushed SHA.
  - 5 snippets and 1 output are synced.
  - The check passes.

- [ ] **Step 6: Prove a missing anchor fails the build.** Change one include to `#nope` and run `pnpm run build:staging`. Expected: it fails with `dealfinder-part-01: step 01 has no snippet dealfinder/schema.py#nope`. Revert, rerun, and expect success. Then delete the untracked topic dirs the staging build left, as `git status --short --untracked-files=all public/` lists them.

- [ ] **Step 7: Shoot twice, to rule out churn**

Run: `node scripts/shoot-course.mjs --steps 01 --companion companions/dealfinder` twice.
Expected:
- The first run prints `written snapshot-brand-audit`. The second prints `unchanged snapshot-brand-audit`.
- The PNG shows the snapshot mode with the polluted raw brands ringed.
- Swap it into Part 1's "What you can demo now", replacing the old shot. Write its `lookFor` text from the real image.

- [ ] **Step 8: See the lesson in the browser.** Serve the staging export and open `/tutorials/dealfinder-part-01/` with chrome-devtools. Confirm the included code renders through Shiki, the output block shows the captured text, and the new screenshot loads. Take a screenshot, then run `rm -rf out` and restart dev.

- [ ] **Step 9: Commit the site side and open the PR**

```bash
git add "app/tutorials/(article)/dealfinder-part-01/page.draft.mdx" content/course/snippets.json public/tutorials/screens/dealfinder-part-01/snapshot-brand-audit.png
git commit -m "feat(tutorials): Part 1 renders code, output and screenshot from step-01 (pilot; still draft)"
git push -u origin feat/deals-course-pipeline && gh pr create --fill
```

Merging needs the owner's explicit go.

After the merge, run `gh workflow run course-shots.yml -f steps=01`. A `workflow_dispatch` workflow runs only from the default branch, which is why this waits for the merge.
Expected: the run is green and opens no PR, because the shot is unchanged.

## Owner setup

| Action | Route tried first | Ask |
|---|---|---|
| Merge the companion PR (Tasks 1-4 and 8) and the site PR (Tasks 5-7 and 9) | none | "reply 'you do it'" |
| Let workflows open PRs in the site repo, for `course-shots` | After the go: `gh api -X PUT repos/cloudcodetree/cloudcodetree.com/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`, quoting any failure | "reply 'you do it'" |
| Move remote `step-*` tags, push `course-v1`, replace `main` | Not in this plan. Plan 7 or the release does it, per `course/RELEASE.md`. | asked then |
