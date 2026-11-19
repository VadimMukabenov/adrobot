# Optional Kubernetes deployment

Docker Compose is sufficient for evaluating the test assignment. The same
multi-stage `Dockerfile` produces the backend + compiled frontend image for
Kubernetes; no Node.js build service or second application image is required.

This example uses **one pod, one Uvicorn worker, SQLite on a PVC, and `Recreate`**.
Do not add replicas/HPA: concurrent instances and automatic recovery after a
process dies during a remote write require additional design. `Recreate` avoids
planned rolling-update overlap; it is not distributed fencing after node loss.
The storage driver must support SQLite locking/WAL and `fsGroup` ownership
(local/block storage, not a generic network filesystem).

## Prepare

Run from the Adrobot repository root. Choose the target cluster and namespace
explicitly. Requires kubectl, a registry reachable by its nodes (with pull
credentials if private), a default StorageClass with the properties above,
tracker connectivity and a Keitaro Admin API key. **No live cluster deployment
is part of this repository's recorded verification.**

Build a versioned image and push it to **your** registry. Replace `YOUR_REGISTRY`:

```bash
docker build -t YOUR_REGISTRY/adrobot:0.1.0 .
docker push YOUR_REGISTRY/adrobot:0.1.0
```

In both `deploy/k8s/adrobot.yaml` and `deploy/k8s/recovery-job.yaml`, replace `image: adrobot:local` with that same image
reference. `adrobot:local` is a local Compose tag, not a published registry image.

Prepare a separate ignored settings file and edit its three values:

```bash
cp -n deploy/k8s/keitaro.env.example .env.k8s
```

**Do not quote values or add `export` in `.env.k8s`.** Unlike Compose dotenv,
`kubectl --from-env-file` preserves quotes literally. Do not reuse the quoted
Compose `.env`. Never commit this file/rendered Secret or pass the key as a
command-line argument.

```bash
kubectl create namespace adrobot
kubectl -n adrobot create secret generic adrobot-keitaro --from-env-file=.env.k8s
kubectl -n adrobot apply -f deploy/k8s/adrobot.yaml
kubectl -n adrobot rollout status deployment/adrobot
kubectl -n adrobot port-forward service/adrobot 8765:8765
```

Open http://127.0.0.1:8765/. Keep port-forward running. The service is ClusterIP;
no Ingress or public administrative endpoint is created. The application has no
user authentication: use a trusted namespace/network, and add authentication,
authorization and TLS before exposing it to other users. Kubernetes Secret is
runtime configuration, not a claim of encryption at rest.

Migrations run before Uvicorn, as in Compose. Probes check the local HTTP process;
they intentionally do not contact Keitaro or perform remote writes. Verify the
campaign list/dropdowns separately. Readiness is not proof of a valid API key.

## Restart and recovery

PVC data survives pod replacement. Set the same `CAMPAIGN_PREFIX` as when drafts
were created. A changed Secret requires `kubectl -n adrobot rollout restart
deployment/adrobot` to reload environment variables. Do not delete the PVC if
you need drafts/history.

A pod restart does **not** automatically resolve a persisted operation that was
running when the previous process stopped. The host or Compose database is not
this PVC. First confirm every old worker has stopped (including failed/unreachable
nodes); if you cannot confirm that, do not run recovery. The Job mounts the same
PVC and never contacts Keitaro:

```bash
kubectl -n adrobot scale deployment/adrobot --replicas=0 &&
kubectl -n adrobot wait --for=delete pod -l app=adrobot --timeout=120s &&
kubectl -n adrobot create -f deploy/k8s/recovery-job.yaml &&
kubectl -n adrobot wait --for=condition=complete job/adrobot-recovery --timeout=120s &&
kubectl -n adrobot logs job/adrobot-recovery
```

Only after a successful Job, delete it and restart the single worker:

```bash
kubectl -n adrobot delete job adrobot-recovery &&
kubectl -n adrobot scale deployment/adrobot --replicas=1 &&
kubectl -n adrobot rollout status deployment/adrobot
```

A failed Job leaves workers stopped. Inspect its logs before retrying; do not
blindly delete a running Job. After restart, use Reconcile in the UI or resume
saved creation. This is a single-instance example, not a high-availability
production installation.

References: [Deployment/Recreate](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#recreate-deployment),
[pod security context and fsGroup](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
