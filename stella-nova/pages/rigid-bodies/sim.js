/*
Copyright 2024 Matthias Müller - Ten Minute Physics, 
www.youtube.com/c/TenMinutePhysics
www.matthiasMueller.info/tenMinutePhysics

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  RIGID BODIES  ·  pages/rigid-bodies/sim.js — the upstream XPBD bodies
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #22, 22-rigidBodies.html by Matthias
//  Müller (MIT, notice above). The classes below are the upstream code:
//  the TextRenderer, RigidBody (box and sphere, integrate, XPBD
//  corrections), the DistanceConstraint (with its cylinder and force
//  label) and the RigidBodySimulator (substeps, drag constraint).
//  Site changes, marked "site:" in the code: RigidBody keeps its scene
//  for dispose(), and the labels turn to labelCamera (set by the page)
//  instead of the global camera. The bodies have no contacts with each
//  other, as upstream.
//
//  OUR ADDITIONS (davesgames.io) are in scenes.js (the scene builders and
//  their parameters) and app.js (the page).
//
//  grep -n targets: "export class RigidBody", "export class
//  DistanceConstraint", "export class RigidBodySimulator", "setLabelCamera"
// ============================================================================
const THREE = globalThis.THREE;
let labelCamera = null;
export function setLabelCamera(c) { labelCamera = c; }

export class TextRenderer {
    constructor(scene, fontSize = 0.05) {
        this.scene = scene;
        this.font = null;
        this.textMesh = null;
        this.fontSize = fontSize;
        this.fontHeight = 0.0001;
        this.loadFont();
    }

    loadFont() {
        return new Promise((resolve, reject) => {
            const loader = new THREE.FontLoader();
            loader.load(
                '../../vendor/three@0.139.2/examples/fonts/helvetiker_regular.typeface.json',
                font => {
                    this.font = font;
                    resolve();
                },
                undefined,
                reject
            );
        });
    }

    createText(text, position, color = 0xffffff) {
        if (this.disposed) return;   // site: a font that loads after dispose() adds no mesh
        if (this.textMesh) {
            this.scene.remove(this.textMesh);
            if (this.textMesh.geometry) this.textMesh.geometry.dispose();
            if (this.textMesh.material) this.textMesh.material.dispose();
        }

        if (!this.font) return;  // If font hasn't loaded yet, skip creating text

        const textGeometry = new THREE.TextGeometry(text, {
            font: this.font,
            size: this.fontSize,
            height: this.fontHeight,
        });
        const textMaterial = new THREE.MeshBasicMaterial({ color: color });
        this.textMesh = new THREE.Mesh(textGeometry, textMaterial);
        this.textMesh.position.copy(position);
        this.scene.add(this.textMesh);
    }

    updatePosition(position) {
        if (this.textMesh) {
            this.textMesh.position.copy(position);
        }
    }

    updateRotation(quaternion) {
        if (this.textMesh) {
            this.textMesh.quaternion.copy(quaternion);
        }
    }

    dispose() {
        this.disposed = true;   // site: see createText
        if (this.textMesh) {
            if (this.textMesh.geometry) this.textMesh.geometry.dispose();
            if (this.textMesh.material) this.textMesh.material.dispose();
            this.scene.remove(this.textMesh);
        }
    }
}

export class RigidBody 
{
    constructor(scene, type, size, density, pos, angles, fontSize = 0.0) 
    {
        this.type = type;
    this.scene = scene;            // site: dispose() removes from this scene
        this.size = new THREE.Vector3(size.x, size.y, size.z);
        this.dt = 0.0;
        this.damping = 0.0;

        this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
        this.rot = new THREE.Quaternion();
        this.rot.setFromEuler(new THREE.Euler(angles.x, angles.y, angles.z));
        this.vel = new THREE.Vector3(0.0, 0.0, 0.0);
        this.omega = new THREE.Vector3(0.0, 0.0, 0.0);

        this.prevPos = this.pos.clone();
        this.prevRot = this.rot.clone();
        this.dRot = new THREE.Quaternion();
        this.invRot = this.rot.clone();
        this.invRot.invert();

        this.invMass = 0.0;
        this.invInertia = new THREE.Vector3();

        this.meshes = [];
        this.vertices = null;
        this.triIds = null;
        let mass = 0.0;

        if (type == "box") 
        {
            let mesh = new THREE.Mesh(
                new THREE.BoxBufferGeometry(size.x, size.y, size.z),
                new THREE.MeshPhongMaterial({ color: 0xffffff })
            );
            this.meshes.push(mesh);
            if (density > 0.0)
            {
                mass = density * size.x * size.y * size.z;
                this.invMass = 1.0 / mass;
                let Ix = 1.0 / 12.0 * mass * (size.y * size.y + size.z * size.z);
                let Iy = 1.0 / 12.0 * mass * (size.x * size.x + size.z * size.z);
                let Iz = 1.0 / 12.0 * mass * (size.x * size.x + size.y * size.y);
                this.invInertia.set(1.0 / Ix, 1.0 / Iy, 1.0 / Iz);
            }
            let ex = 0.5 * size.x;
            let ey = 0.5 * size.y;
            let ez = 0.5 * size.z;

            this.vertices = new Float32Array([
                -ex, -ey, -ez,
                ex, -ey, -ez,
                ex, ey, -ez,
                -ex, ey, -ez,
                -ex, -ey, ez,
                ex, -ey, ez,
                ex, ey, ez,
                -ex, ey, ez
            ]);
        }
        else if (type == "sphere") 
        {
            let hemiSphere0 = new THREE.Mesh(
                new THREE.SphereBufferGeometry(size.x, 32, 32, 0.0, Math.PI),
                new THREE.MeshPhongMaterial({ color: 0xffffff })
            );
            let hemiSphere1 = new THREE.Mesh(
                new THREE.SphereBufferGeometry(size.x, 32, 32, Math.PI, Math.PI),
                new THREE.MeshPhongMaterial({ color: 0xff0000 })
            );
            this.meshes.push(hemiSphere0);
            this.meshes.push(hemiSphere1);
            if (density > 0.0)
            {
                mass = 4.0 / 3.0 * Math.PI * size.x * size.x * size.x * density;
                this.invMass = 1.0 / mass;
                let I = 2.0 / 5.0 * mass * size.x * size.x;
                this.invInertia.set(1.0 / I, 1.0 / I, 1.0 / I);
            }
        }

        for (let i = 0; i < this.meshes.length; i++) {
            let mesh = this.meshes[i];
            mesh.body = this;        // for raycasting
            mesh.layers.enable(1);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
        }

        // Create text renderer for mass display
        this.textRenderer = null;
        if (fontSize > 0.0) {
            this.textRenderer = new TextRenderer(scene, fontSize);
            this.textRenderer.loadFont().then(() => {
                this.textRenderer.createText(`                      ${mass.toFixed(1)} kg`, this.meshes[0].position);
            });
        }
        
        this.updateMeshes();
    }

    updateMeshes()
    {
        for (let i = 0; i < this.meshes.length; i++)
        {
            this.meshes[i].position.copy(this.pos);
            this.meshes[i].quaternion.copy(this.rot);
            this.meshes[i].geometry.computeBoundingSphere();
        }
        
        if (this.textRenderer) {
            this.textRenderer.updatePosition(this.meshes[0].position);
            if (labelCamera) this.textRenderer.updateRotation(labelCamera.quaternion);   // site: was the global camera
        }           
    }                

    // begin simulation functions

    localToWorld(localPos, worldPos)
    {
        worldPos.copy(localPos);
        worldPos.applyQuaternion(this.rot);
        worldPos.add(this.pos);
    }

    worldToLocal(worldPos, localPos)
    {
        localPos.copy(worldPos);
        localPos.sub(this.pos);
        localPos.applyQuaternion(this.invRot);
    }

    integrate(dt, gravity)
    {
        this.dt = dt;

        if (this.invMass == 0.0)
            return;

        // linear motion
        this.prevPos.copy(this.pos);
        this.vel.addScaledVector(gravity, dt);
        this.pos.addScaledVector(this.vel, dt);

        // angular motion
        this.prevRot.copy(this.rot);
        this.dRot.set(
            this.omega.x,
            this.omega.y,
            this.omega.z,
            0.0
        );
        this.dRot.multiply(this.rot);
        this.rot.x += 0.5 * dt * this.dRot.x;
        this.rot.y += 0.5 * dt * this.dRot.y;
        this.rot.z += 0.5 * dt * this.dRot.z;
        this.rot.w += 0.5 * dt * this.dRot.w;
        this.rot.normalize();
        this.invRot.copy(this.rot);
        this.invRot.invert();
    }

    updateVelocities()
    {   
        if (this.invMass == 0.0)
            return;

        // linear motion
        this.vel.subVectors(this.pos, this.prevPos);
        this.vel.multiplyScalar(1.0 / this.dt);

        // angular motion
        this.prevRot.invert();
        this.dRot.multiplyQuaternions(this.rot, this.prevRot);
        this.omega.set(
            this.dRot.x * 2.0 / this.dt,
            this.dRot.y * 2.0 / this.dt,
            this.dRot.z * 2.0 / this.dt
        );
        if (this.dRot.w < 0.0)
            this.omega.negate();
        
        this.vel.multiplyScalar(Math.max(1.0 - this.damping * this.dt, 0.0));
    }

    getInverseMass(normal, pos)
    {
        if (this.invMass == 0.0)
            return 0.0;

        let rn = normal.clone();

        if (pos == undefined)  // angular case
        {
            rn.applyQuaternion(this.invRot);
        }
        else            // linear case
        {
            rn.subVectors(pos, this.pos);
            rn.cross(normal);
            rn.applyQuaternion(this.invRot);
        }

        let w = 
            rn.x * rn.x * this.invInertia.x + 
            rn.y * rn.y * this.invInertia.y + 
            rn.z * rn.z * this.invInertia.z;

        if (pos != undefined)
            w += this.invMass;
     
        return w;
    }

    _applyCorrection(corr, pos)
    {
        if (this.invMass == 0.0)
            return;

        // linear correction

        this.pos.addScaledVector(corr, this.invMass);

        // angular correction

        let dOmega = corr.clone();

        dOmega.subVectors(pos, this.pos);
        dOmega.cross(corr);
        dOmega.applyQuaternion(this.invRot);
        dOmega.multiply(this.invInertia);
        dOmega.applyQuaternion(this.rot);

        this.dRot.set(
            dOmega.x,
            dOmega.y,
            dOmega.z,
            0.0
        );

        this.dRot.multiply(this.rot);
        this.rot.x += 0.5 * this.dRot.x;
        this.rot.y += 0.5 * this.dRot.y;
        this.rot.z += 0.5 * this.dRot.z;
        this.rot.w += 0.5 * this.dRot.w;
        this.rot.normalize();
        this.invRot.copy(this.rot);
        this.invRot.invert();
    }

    applyCorrection(compliance, corr, pos, otherBody, otherPos)
    {
        if (corr.lengthSq() == 0.0)
            return;

        let C = corr.length();
        let normal = corr.clone();
        normal.normalize();

        let w = this.getInverseMass(normal, pos);
        if (otherBody != undefined)
            w += otherBody.getInverseMass(normal, otherPos);

        if (w == 0.0)
            return;

        // XPBD
        let alpha = compliance / this.dt / this.dt;
        let lambda = -C / (w + alpha);
        normal.multiplyScalar(-lambda);

        this._applyCorrection(normal, pos);
        if (otherBody != undefined) {
            normal.multiplyScalar(-1.0);
            otherBody._applyCorrection(normal, otherPos);
        }
        return lambda / this.dt / this.dt;
    }

    // end simulation functions

    dispose() {
        for (let i = 0; i < this.meshes.length; i++) {
            if (this.meshes[i].geometry) this.meshes[i].geometry.dispose();
            if (this.meshes[i].material) this.meshes[i].material.dispose();
            this.scene.remove(this.meshes[i]);   // site: was the global scene
        }
        if (this.textRenderer) {
            this.textRenderer.dispose();
        }
    }
}

export class DistanceConstraint {
    constructor(scene, body0, body1, pos0, pos1, distance, compliance, unilateral, width = 0.01, fontSize = 0.0, color = 0xff0000) {
        this.scene = scene;
        this.body0 = body0;
        this.body1 = body1;
        this.unilateral = unilateral;

        this.worldPos0 = pos0.clone();
        this.worldPos1 = pos1.clone();
        this.localPos0 = pos0.clone();
        this.localPos1 = pos1.clone();

        this.body0.worldToLocal(pos0, this.localPos0);
        if (body1 != undefined)
            this.body1.worldToLocal(pos1, this.localPos1);

        this.distance = distance;
        this.compliance = compliance;

        this.corr = new THREE.Vector3();

        // Create a cylinder for visualization
        const geometry = new THREE.CylinderGeometry(width, width, 1, 32);
        const material = new THREE.MeshBasicMaterial({ color: color });
        this.cylinder = new THREE.Mesh(geometry, material);
        this.cylinder.castShadow = true;
        this.cylinder.receiveShadow = true;
        scene.add(this.cylinder);

        // Create text renderer for force display
        this.textRenderer = null;
        if (fontSize > 0.0) {
            this.textRenderer = new TextRenderer(scene, fontSize);
            this.textRenderer.loadFont().then(() => {
                this.updateText(0, 1);
                this.updateMesh();
            });
        }

        this.updateMesh();
    }

    solve() {
        this.body0.localToWorld(this.localPos0, this.worldPos0);
        if (this.body1 != undefined)
            this.body1.localToWorld(this.localPos1, this.worldPos1);
        this.corr.subVectors(this.worldPos1, this.worldPos0);
        let distance = this.corr.length();
        this.corr.normalize();
        if (this.unilateral && distance < this.distance)
            return;
        this.corr.multiplyScalar(distance - this.distance);
        let force = this.body0.applyCorrection(this.compliance, this.corr, this.worldPos0, this.body1, this.worldPos1);
        
        let elongation = distance - this.distance;
        elongation = Math.round(elongation * 100) / 100;
        this.updateText(Math.abs(force), elongation);
    }                

    updateMesh() {
        const start = this.worldPos0;
        const end = this.worldPos1;

        // Calculate the center point
        const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

        // Calculate the direction vector
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();

        // Create a rotation quaternion
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

        // Update cylinder's transformation
        this.cylinder.position.copy(center);
        this.cylinder.setRotationFromQuaternion(quaternion);
        this.cylinder.scale.set(1, length, 1);

        // Update text position and rotation
        if (this.textRenderer) {
            this.textRenderer.updatePosition(center);
            if (labelCamera) this.textRenderer.updateRotation(labelCamera.quaternion);   // site: was the global camera
        }
    }

    updateText(force, elongation) {
        if (this.textRenderer) {
            this.textRenderer.createText(`   ${Math.round(force)} N,  ${elongation} m`, this.cylinder.position);
        }
    }

    dispose() {
        if (this.cylinder) {
            if (this.cylinder.geometry) this.cylinder.geometry.dispose();
            if (this.cylinder.material) this.cylinder.material.dispose();
            this.scene.remove(this.cylinder);
        }
        if (this.textRenderer) {
            this.textRenderer.dispose();
        }
    }
}

export class RigidBodySimulator 
{
    constructor(scene, timeStepSize, gravity)
    {
        this.scene = scene;
        this.gravity = gravity.clone();
        this.dt = timeStepSize;
        this.numSubSteps = 10;
        this.numIterations = 1;
        this.rigidBodies = [];
        this.distanceConstraints = [];

        this.dragConstraint = null;
        this.dragCompliance = 0.001;
    }

    addRigidBody(rigidBody)
    {
        this.rigidBodies.push(rigidBody);
    }

    addDistanceConstraint(distanceConstraint)
    {
        this.distanceConstraints.push(distanceConstraint);
    }

    simulate()
    {
        let sdt = this.dt / this.numSubSteps;

        for (let subStep = 0; subStep < this.numSubSteps; subStep++)
        {
            for (let i = 0; i < this.rigidBodies.length; i++)
                this.rigidBodies[i].integrate(sdt, this.gravity);

            for (let i = 0; i < this.distanceConstraints.length; i++)
                this.distanceConstraints[i].solve();

            if (this.dragConstraint)
                this.dragConstraint.solve();

            for (let i = 0; i < this.rigidBodies.length; i++)
            {
                this.rigidBodies[i].updateVelocities(sdt);
            }
        }
        for (let i = 0; i < this.rigidBodies.length; i++)
            this.rigidBodies[i].updateMeshes();

        for (let i = 0; i < this.distanceConstraints.length; i++)
            this.distanceConstraints[i].updateMesh();

        if (this.dragConstraint)
            this.dragConstraint.updateMesh();
    }

    startDrag(body, pos)
    {
        this.dragConstraint = new DistanceConstraint(this.scene, body, null, pos, pos, 0.0, this.dragCompliance);
    }

    drag(pos)
    {
        if (this.dragConstraint)
            this.dragConstraint.worldPos1.copy(pos);
    }

    endDrag(pos)
    {
        if (this.dragConstraint)
        {
            this.dragConstraint.dispose();
            this.dragConstraint = null;
        }
    }

    dispose()
    {
        for (let i = 0; i < this.rigidBodies.length; i++)
            this.rigidBodies[i].dispose();

        for (let i = 0; i < this.distanceConstraints.length; i++)
            this.distanceConstraints[i].dispose();

        if (this.dragConstraint)
            this.dragConstraint.dispose();
    }
}
