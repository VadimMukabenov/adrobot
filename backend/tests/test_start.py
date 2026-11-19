"""Exercise the public entry point from a different working directory."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


def test_start_uses_its_own_project_and_preserves_existing_settings(tmp_path):
    repo = tmp_path / "adrobot clone"
    repo.mkdir()
    source = Path(__file__).resolve().parents[2] / "start"
    assert source.exists(), "A location-independent start entry point is required"
    shutil.copy2(source, repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    env = repo / ".env"
    env.write_text("KEITARO_API_KEY=existing-settings\n")
    before = env.read_bytes()
    tools = tmp_path / "tools"
    tools.mkdir()
    log = tmp_path / "docker-call"
    docker = tools / "docker"
    docker.write_text('#!/bin/sh\nprintf "%s\\n" "$PWD|$*" >> "$QA_DOCKER_LOG"\n'
                      'if [ "$*" = "compose port app 8765" ]; then echo 127.0.0.1:8765; fi\n')
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start")], cwd=tmp_path, text=True, capture_output=True,
        env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"],
             "QA_DOCKER_LOG": str(log)},
    )
    assert result.returncode == 0, result.stderr
    assert env.read_bytes() == before
    calls = log.read_text().splitlines()
    assert f"{repo}|compose up --build --wait" in calls
    assert "http://127.0.0.1:" in result.stdout


def test_first_start_hides_key_and_writes_private_parseable_configuration(tmp_path):
    from adrobot.settings import Settings

    repo = tmp_path / "fresh clone"
    repo.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[2] / "start", repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    tools = tmp_path / "tools"
    tools.mkdir()
    docker = tools / "docker"
    docker.write_text(
        '#!/bin/sh\nif [ "$*" = "compose port app 8765" ]; then echo 127.0.0.1:8765; fi\n'
    )
    docker.chmod(0o755)
    key = "synthetic'key$literal"
    result = subprocess.run(
        ["bash", str(repo / "start")], cwd=tmp_path, text=True, capture_output=True,
        input="https://localhost:9443/\n" + key + "\n",
        env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"]},
    )
    assert result.returncode == 0, result.stderr
    settings = Settings(_env_file=repo / ".env")
    assert settings.keitaro_api_key.get_secret_value() == key
    assert settings.keitaro_base_url == "https://localhost:9443"
    assert (repo / ".env").stat().st_mode & 0o777 == 0o600
    assert key not in result.stdout + result.stderr


@pytest.mark.parametrize(
    ("address", "origin"),
    [("https://localhost:9443/admin/#!/campaigns", "https://localhost:9443"),
     ("", "https://tlgk.host")],
)
def test_start_accepts_admin_url_or_enter_for_test_tracker(tmp_path, address, origin):
    from adrobot.settings import Settings

    repo = tmp_path / "clone"
    repo.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[2] / "start", repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    tools = tmp_path / "tools"
    tools.mkdir()
    docker = tools / "docker"
    docker.write_text(
        '#!/bin/sh\nif [ "$*" = "compose port app 8765" ]; then echo 127.0.0.1:8765; fi\n'
    )
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start")], cwd=tmp_path, text=True, capture_output=True,
        input=address + "\nsynthetic-key\n",
        env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"]},
    )
    assert result.returncode == 0, result.stderr
    assert Settings(_env_file=repo / ".env").keitaro_base_url == origin


def test_start_rejects_example_address_without_saving_configuration(tmp_path):
    repo = tmp_path / "clone"
    repo.mkdir()
    shutil.copy2(Path(__file__).resolve().parents[2] / "start", repo / "start")
    (repo / "compose.yaml").write_text("services: {}\n")
    tools = tmp_path / "tools"
    tools.mkdir()
    docker = tools / "docker"
    docker.write_text('#!/bin/sh\nexit 0\n')
    docker.chmod(0o755)
    result = subprocess.run(
        ["bash", str(repo / "start")], cwd=tmp_path, text=True, capture_output=True,
        input="https://tracker-keitaro.example.com\nsynthetic-key\n",
        env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"]},
    )
    assert result.returncode != 0
    assert "example" in result.stderr.lower()
    assert not (repo / ".env").exists()
