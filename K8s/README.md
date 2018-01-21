# Azure AKS Deployment Prototype

Prototyping work has been done to deploy the Assisted Prescription application to managed Kubernetes on Azure (AKS).
The base components needed for the application are included in the deployment, but not the ELK stack, nor the Prometheus
monitoring capabilities.

## Install Tools

- Install kubectl - https://kubernetes.io/docs/tasks/tools/install-kubectl  
  (Verified with v1.8.0)
- ...

## Create the Azure Kubernetes Cluster

_TODO: Write this_

## Copy Application Data

Copy the data files used by the application to the AKS VM with:

```sh
cd K8s/plain
scp -i <private ssh key> -r ../../data/doc/ azureuser@$<ip>:/home/azureuser
scp -i <private ssh key> -r ../../data/csv/ azureuser@$<ip>:/home/azureuser
```

## Prepare Secrets

Manually create secrets in the Kubernetes cluster with (replace Docker Hub creds with actual creds):

```sh
cd K8s/plain
kubectl create secret docker-registry dockerhub --docker-username=... --docker-password=... --docker-email=...
kubectl create secret generic accounts --from-file=../../secrets/ACCOUNTS
kubectl create secret generic jwt-secret --from-file=../../secrets/JWT_SECRET
kubectl create secret generic cookie-signing --from-file=../../secrets/COOKIE_SIGNING
```

## Deploy

Deploy services and deployments to the cluster with:

```sh
$ cd K8s/plain
$ kubectl create -f app/
deployment "auth" created
service "auth" created
deployment "engine" created
service "engine" created
deployment "mira" created
service "mira" created
deployment "openresty" created
service "openresty" created
deployment "qix-session" created
service "qix-session" created
deployment "redis" created
service "redis" created
```

## Launch the Minikube Dashboard

_TODO: Update this for Azure AKS_

Observe that all workloads get deployed and get to running state by launchg the dashboard:

```sh
minikube dashboard
```

## Launch the Application

_TODO: Update this for Azure AKS_

Check the IP address of the Minkube VM. For example, with:

```sh
minikube ip
```

Open a browser and navigate to https://<Minikube VM IP>:31704. Sign in with the "local" identity provided (e.g.
`admin:password`) and the Assisted Prescription UI should be displayed.
