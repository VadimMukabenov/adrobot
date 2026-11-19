"""Run the public launcher from elsewhere, with no terminal input or settings."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("existing_env", [False, True])
def test_start_needs_no_input_uses_own_directory_and_preserves_settings(tmp_path, existing_env):
    repo = tmp_path / "adrobot clone"
    repo.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[2] / "start", repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    env = repo / ".env"
    content = "KEITARO_API_KEY=existing-settings\n"
    if existing_env:
        env.write_text(content)
    tools = tmp_path / "tools"
    tools.mkdir()
    log = tmp_path / "docker-call"
    docker = tools / "docker"
    docker.write_text(
        '#!/bin/sh\nprintf "%s\\n" "$PWD|$*" >> "$QA_DOCKER_LOG"\n'
        'if [ "$*" = "compose port app 8765" ]; then echo 127.0.0.1:8765; fi\n'
    )
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start")],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        input="",
        env={
            **os.environ,
            "PATH": str(tools) + os.pathsep + os.environ["PATH"],
            "QA_DOCKER_LOG": str(log),
        },
    )
    assert result.returncode == 0, result.stderr
    assert f"{repo}|compose up --build --wait" in log.read_text().splitlines()
    assert "http://127.0.0.1:8765/" in result.stdout
    assert "Connect to Keitaro on that page." in result.stdout
    if existing_env:
        assert env.read_text() == content
    else:
        assert not env.exists()


def test_demo_launcher_ignores_live_dotenv_and_uses_an_isolated_project(tmp_path):
    repo = tmp_path / "adrobot demo clone"
    repo.mkdir()
    source = Path(__file__).resolve().parents[2]
    shutil.copy2(source / "start", repo / "start")
    for name in ("compose.yaml", "compose.demo.yaml"):
        (repo / name).write_text("services: {}\n")
    original = "DATABASE_URL=sqlite:///live.db\nKEITARO_API_KEY=live-marker\n"
    (repo / ".env").write_text(original)
    tools = tmp_path / "tools"
    tools.mkdir()
    log = tmp_path / "calls"
    docker = tools / "docker"
    docker.write_text(
        '#!/bin/sh\nprintf "%s|%s|key=%s\\n" "$PWD" "$*" '
        '"${KEITARO_API_KEY-unset}" >> "$QA_DOCKER_LOG"\n'
        'case "$*" in *"port app 8765") echo 127.0.0.1:8766;; esac\n'
    )
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start"), "--demo"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        input="",
        env={
            **os.environ,
            "PATH": str(tools) + os.pathsep + os.environ["PATH"],
            "QA_DOCKER_LOG": str(log),
            "KEITARO_API_KEY": "inherited-live-marker",
        },
    )
    assert result.returncode == 0, result.stderr
    calls = log.read_text()
    assert "--env-file /dev/null -p adrobot-demo -f compose.demo.yaml up --build --wait" in calls
    assert "key=unset" in calls
    assert "http://127.0.0.1:8766/" in result.stdout
    assert "Demo" in result.stdout
    assert (repo / ".env").read_text() == original


@pytest.mark.parametrize("mode", ["live", "demo"])
def test_ready_image_launcher_pulls_without_building_and_isolates_ambient_project(tmp_path, mode):
    repo = tmp_path / "adrobot"
    repo.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[2] / "start", repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    (repo / "compose.release.yaml").write_text("services: {}\n")
    tools = tmp_path / "tools"
    tools.mkdir()
    log = tmp_path / "calls"
    docker = tools / "docker"
    docker.write_text(
        '#!/bin/sh\nprintf "%s|mode=%s|port=%s\\n" "$*" '
        '"${APP_MODE-unset}" "${ADROBOT_PORT-unset}" >> "$QA_DOCKER_LOG"\n'
        'case "$*" in *"port app 8765") echo 127.0.0.1:8766;; esac\n'
    )
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start"), *(["--demo"] if mode == "demo" else []), "--image"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        input="",
        env={
            **os.environ,
            "PATH": str(tools) + os.pathsep + os.environ["PATH"],
            "QA_DOCKER_LOG": str(log),
            "COMPOSE_PROJECT_NAME": "adrobot",
        },
    )
    assert result.returncode == 0, result.stderr
    calls = log.read_text()
    assert f"-p adrobot-release-{mode} -f compose.release.yaml up --pull always --wait" in calls
    assert "--build" not in calls
    assert f"mode={mode}" in calls
    if mode == "demo":
        assert "port=8766" in calls
    assert "http://127.0.0.1:8766/" in result.stdout
