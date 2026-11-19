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
