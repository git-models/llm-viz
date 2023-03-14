import { cameraMoveToDesired, ICamera } from "./Camera";
import { drawAllArrows } from "./components/Arrow";
import { drawBlockLabels } from "./components/BlockLabels";
import { drawModelCard } from "./components/ModelCard";
import { IGpuGptModel, IModelShape } from "./GptModel";
import { genGptModelLayout, IGptModelLayout } from "./GptModelLayout";
import { IFontAtlasData } from "./render/fontRender";
import { initRender, IRenderState, IRenderView, renderModel, resetRenderBuffers } from "./render/modelRender";
import { beginQueryAndGetPrevMs, endQuery } from "./render/queryManager";
import { drawTokens } from "./render/tokenRender";
import { SavedState } from "./SavedState";
import { isNotNil, Subscriptions } from "./utils/data";
import { Vec3 } from "./utils/vector";
import { initWalkthrough, runWalkthrough } from "./walkthrough/Walkthrough";

export interface IProgramState {
    render: IRenderState;
    walkthrough: ReturnType<typeof initWalkthrough>;
    camera: ICamera;
    htmlSubs: Subscriptions;
    layout: IGptModelLayout;
    shape: IModelShape;
    gptGpuModel: IGpuGptModel | null;
    markDirty: () => void;
}

export function initProgramState(canvasEl: HTMLCanvasElement, fontAtlasData: IFontAtlasData): IProgramState {

    let render = initRender(canvasEl, fontAtlasData);
    let walkthrough = initWalkthrough();

    let prevState = SavedState.state;
    let camera: ICamera = {
        angle: prevState?.camera.angle ?? new Vec3(290, 38, 2.5),
        center: prevState?.camera.center ?? new Vec3(-6, 0, -80),
        transition: {},
    }

    let shape: IModelShape = {
        B: 1,
        T: 11,
        C: 48,
        nHeads: 3,
        A: 48 / 3,
        nBlocks: 3,
        vocabSize: 3,
    };

    return {
        render,
        walkthrough,
        camera,
        shape,
        layout: genGptModelLayout(shape),
        gptGpuModel: null,
        markDirty: () => { },
        htmlSubs: new Subscriptions(),
    };
}

export function runProgram(view: IRenderView, state: IProgramState) {
    let timer0 = performance.now();

    resetRenderBuffers(state.render);

    if (state.walkthrough.running) {
        cameraMoveToDesired(state.camera, view.dt);
    }

    // generate the base model, incorporating the gpu-side model if available
    state.layout = genGptModelLayout(state.shape, state.gptGpuModel);

    let queryRes = beginQueryAndGetPrevMs(state.render.queryManager, 'render');
    if (isNotNil(queryRes)) {
        state.render.lastGpuMs = queryRes;
    }

    // will modify layout; view; render a few things.
    runWalkthrough(state, view);

    // these will get modified by the walkthrough (stored where?)
    drawAllArrows(state.render, state.layout);
    drawBlockLabels(state.render, state.layout);

    drawModelCard(state);
    drawTokens(state.render, state.layout, undefined, undefined, state.render.tokenColors || undefined);

    // render the model and a few other things
    renderModel(state);

    endQuery(state.render.queryManager, 'render');
    state.render.gl.flush();

    state.render.lastJsMs = performance.now() - timer0;
}
