import { addSourceDestCurveLine, blockDimension, blockIndex, drawTextOnModel, findSubBlocks, indexMappingLines, renderIndexes, splitGridX, TextAlignHoriz, TextAlignVert } from "../Annotations";
import { IBlkDef } from "../GptModelLayout";
import { IProgramState } from "../Program";
import { IRenderView } from "../render/modelRender";
import { drawThread } from "../render/threadRender";
import { SavedState } from "../SavedState";
import { oneHotArray } from "../utils/data";
import { lerp, lerpSmoothstep } from "../utils/math";
import { Dim, Vec3, Vec4 } from "../utils/vector";
import { DimStyle, dimStyleColor, hideFromBlock, ICommentaryRes, IPhaseGroup, ITimeInfo, IWalkthroughArgs, moveCameraTo, phaseTools } from "./WalkthroughTools";
import { walkthroughIntro } from "./Walkthrough_Intro";


/**

Thoughts about the walkthrough:

- Linking text events to the visual actions doesn't work well.
- Attention needs to flip between them directly. Much better to do a chunk of text, then [Spacebar], then action.
  Can still do aligned highlights though, but focused on the model, and linking back to the text.
  This also works well with hover on either. The color-coding helps a lot anyway.

- Better to do all this text in html, it adds searchability, and supports more things. _However_, probably
  difficult to do TeX fonts. Although maybe that's a bit excessive anyway.

- Can show a reasonable amount of text: Limit to half a screen on mobile, say.

- Fast but smooth transitions, with a pause in between, is much better.
- Slow, linked transitions is kinda nauseating.

- Need more controls! Mainly jumping between phases, and selecting times on phases.
- Can compute the latest time on each phase by keeping track of the events. Can keep this in an array for
  display as well.
- Need to push back into react-land at the end of each frame. (commentary; stats; etc)
- Probably need to query all the phases up front somehow. Could have a pass where we don't actually
  update anything, but read off info for each one. A pain for the in-place updates though. Likely to break
  things. Easier to just have a list of them and info like titles.
- Hmm, do want to expand to total time, hmm.

- Need a bunch more annotations/effects yet
  - Get the trails working well
  - Want a descriptor of how a cell is computed (x, y from these; mul by a, b from these, plus this; all added, [t])
  - It applies to everything, and could allow for 'draw for this 1 cell', 'draw for this col/row of cells'.
  - Curved arrows and flows with thickness
    - Arrows for showing embedding mapping, and for linking src & sink
    - Flows for the residual pathway: wide transparent no-width path, with glowing more-solid sides
      - Basically wide arrows
      - Also need side bit coming off of it for when it's copied
      - Not as wide as the actual block; keep it maybe half-T thick
      - Some indication of flow
  - Highlight block or row/column

 */


export type IWalkthrough = ReturnType<typeof initWalkthrough>;

export function initWalkthrough() {
    return {
        phase: SavedState.state?.phase ?? Phase.Intro_Intro,
        time: SavedState.state?.phaseTime ?? 0,
        running: false,
        lastBreakTime: null as number | null,
        commentary: null as ICommentaryRes | null,
        times: [] as ITimeInfo[],
        phaseLength: 0,
        markDirty: () => { }, // bit of a hack to get it to WalkthroughSidebar
        phaseData: new Map<Phase, any>(),
        phaseList: [{
            groupId: PhaseGroup.Intro,
            title: 'Introduction',
            phases: [
                { id: Phase.Intro_Intro, title: 'Overview' },
            ],
        }, {
            groupId: PhaseGroup.Detailed_Input,
            title: 'Detailed - Input',
            phases: [
                { id: Phase.Input_First, title: 'The First' },
                { id: Phase.Input_Detail_Tables, title: 'Embedding Tables' },
                { id: Phase.Input_Detail_TokEmbed, title: 'Embedding Action' },
                { id: Phase.LayerNorm1, title: 'First Layer Norm' },
            ],
        }] as IPhaseGroup[],
    };
}

export enum PhaseGroup {
    Intro,
    Detailed_Input,
}


export enum Phase {
    Intro_Intro,

    Input_First,
    Input_Detail_Tables,
    Input_Detail_TokEmbed,
    LayerNorm1,
}

export function phaseToGroup(wt: IWalkthrough) {
    return wt.phaseList.find(g => g.phases.find(p => p.id === wt.phase))!;
}


export function runWalkthrough(state: IProgramState, view: IRenderView) {
    let { layout, render } = state;

    if (state.walkthrough.running) {
        state.walkthrough.time += view.dt / 1000;

        if (state.walkthrough.time > state.walkthrough.phaseLength) {
            state.walkthrough.running = false;
            state.walkthrough.time = state.walkthrough.phaseLength;
        }

        view.markDirty();
    }

    SavedState.state = {
        phase: state.walkthrough.phase,
        phaseTime: state.walkthrough.time,
        camera: state.camera,
    };

    let cam = state.camera;
    let phaseState = state.walkthrough;
    phaseState.times = [];

    let tools = phaseTools(state);
    let { atTime, atEvent, afterTime, cleanup, commentary, commentaryPara, c_str } = tools;

    render.tokenColors = null;

    let wtArgs: IWalkthroughArgs = { state, layout, tools, walkthrough: state.walkthrough };

    let groupId = phaseToGroup(phaseState).groupId;
    if (groupId === PhaseGroup.Intro) {
        walkthroughIntro(wtArgs);
        return;
    }

    switch (phaseState.phase) {

    case Phase.Input_First: {
        let t0 = c_str('', 0);
        let c = commentary`These vectors now pass through the stages of the model, going through a series of transformers.${t0}`;
        let t1 = atEvent(t0);
        let t1a = afterTime(t1, 0.0, 2.0);
        let t2 = afterTime(t1a, 5, 0.2);

        if (!t2.active) {
            cam.centerDesired = new Vec3(0, 0, -30);
            cam.angleZDesired = 1.2;
            cam.angleRotDesired = new Vec3(290, 20);
        }

        let blocks = layout.cubes.filter(b => b.t === 'i');
        let pos = lerpSmoothstep(0, blocks.length, t2.t);
        let idx = Math.floor(pos);
        for (let i = Math.min(idx, blocks.length - 1); i >= 0; i--) {
            if (!t2.active) {
                break;
            }
            // blocks that are <= idx should have a falloff applied based on how much they're earlier than idx
            let falloff = 1.0 - (pos - i) / 8;
            if (falloff < 0) {
                break;
            }
            let blk = blocks[i];
            blk.highlight = falloff * 0.8;
            // blk.access?.enable();
        }
        if (idx < blocks.length - 1) {
            let blk = blocks[idx];
            hideFromBlock(render, layout, blk);
        }

        break;
    }

    case Phase.Input_Detail_Tables: {

        // practice drawing labels on tensors
        let t0_showAll = atTime(0, 0.1, 0.2);
        t0_showAll.t = 1.0;

        let tokEmbed = layout.tokEmbedObj;
        drawTextOnModel(render, 'token-embedding matrix', new Vec3(tokEmbed.x - layout.margin, tokEmbed.y + tokEmbed.dy / 4, 0), {
            align: TextAlignHoriz.Right,
            valign: TextAlignVert.Middle,
            color: new Vec4(0,0,0,1).mul(t0_showAll.t),
            size: 3,
        });
        let posEmbed = layout.posEmbedObj;
        drawTextOnModel(render, 'position-embedding matrix', new Vec3(posEmbed.x + posEmbed.dx + layout.margin, tokEmbed.y + tokEmbed.dy / 4, 0), {
            align: TextAlignHoriz.Left,
            valign: TextAlignVert.Middle,
            color: new Vec4(0,0,0,1).mul(t0_showAll.t),
            size: 3,
        });

        blockDimension(render, layout, tokEmbed, Dim.X, DimStyle.n_vocab, t0_showAll.t);
        blockDimension(render, layout, tokEmbed, Dim.Y, DimStyle.C, t0_showAll.t);

        blockDimension(render, layout, posEmbed, Dim.X, DimStyle.T, t0_showAll.t);
        blockDimension(render, layout, posEmbed, Dim.Y, DimStyle.C, t0_showAll.t);

        blockDimension(render, layout, layout.residual0, Dim.X, DimStyle.T, t0_showAll.t);
        blockDimension(render, layout, layout.residual0, Dim.Y, DimStyle.C, t0_showAll.t);

    } break;
    case Phase.Input_Detail_TokEmbed: {
        let tStr = c_str('t', 1);
        let c = commentary`Let's start at the top. To compute the vectors at each time ${tStr} we do a couple of steps:`;

        moveCameraTo(render, atTime(0), new Vec3(0, 0, 0), new Vec3());

        let t0_expandAt0 = atTime(0, 0.1, 0.2);
        let t1_totEq3 = afterTime(t0_expandAt0, 1.0, 0.2);
        let t2_expandSplit = afterTime(t1_totEq3, 0.1, 0.4);

        let t3_showTokEmIdx = afterTime(t2_expandSplit, 0.2, 1.0);
        let t4_highlightTokEmIdx = afterTime(t3_showTokEmIdx, 0.4, 1.0);
        let t5_iter1Col = afterTime(t4_highlightTokEmIdx, 1.0, 1.0);
        let t6_cleanup1 = afterTime(t5_iter1Col, 0.3, 1.0);

        cleanup(t6_cleanup1, [t0_expandAt0, t2_expandSplit, t4_highlightTokEmIdx, t5_iter1Col]);

        let t7_iterCols = afterTime(t6_cleanup1, 5.0, 0.0);

        let exampleTIdx = 3;
        let exampleTokIdx = layout.model?.inputBuf[exampleTIdx] ?? 1;

        // blockDimension(state, layout, layout.residual0, Dim.X, DimStyle.T, 0.5);
        if (t6_cleanup1.t < 1.0) {
            let idx = lerp(0, 3, t1_totEq3.t);
            let split = lerpSmoothstep(t0_expandAt0.t * 1.0, exampleTIdx, t2_expandSplit.t);
            blockIndex(render, layout, layout.residual0, Dim.X, DimStyle.t, idx, split / 2, t0_expandAt0.t);
            splitGridX(layout, layout.residual0, Dim.X, idx + 0.5, split);
            splitGridX(layout, layout.idxObj   , Dim.X, idx + 0.5, split);
        }

        let embedMtx = c_str('token embedding matrix');
        let tokCol = c_str('j');
        commentaryPara(c)`\n\n1. From the ${embedMtx}, select the ${tokCol}'th column.`;

        let embedOffColor = new Vec4(0.5,0.5,0.5).mul(0.6);

        if (layout.model && t7_iterCols.t <= 0.0) {
            let mixes = new Array(layout.tokEmbedObj.cx).fill(0.0);
            mixes[layout.model!.inputBuf[exampleTIdx]] = t4_highlightTokEmIdx.t;
            renderIndexes(render, layout, layout.tokEmbedObj, embedOffColor, t3_showTokEmIdx.t, exampleTIdx, 0, null, { color2: dimStyleColor(DimStyle.n_vocab), mixes });
        }

        if (layout.model && t4_highlightTokEmIdx.t > 0 && t6_cleanup1.t <= 1.0) {
            splitGridX(layout, layout.tokEmbedObj, Dim.X, exampleTokIdx, 0);
            findSubBlocks(layout.tokEmbedObj, Dim.X, exampleTokIdx, exampleTokIdx)[0].highlight = lerp(0, 0.2, t4_highlightTokEmIdx.t);
            render.tokenColors = { color2: dimStyleColor(DimStyle.n_vocab), mixes: oneHotArray(layout.idxObj.cx, exampleTIdx, t4_highlightTokEmIdx.t) };
            let padTop = layout.cell * 0.3;
            let padBot = layout.cell * 0.3 + 3;
            let color = dimStyleColor(DimStyle.n_vocab).mul(t4_highlightTokEmIdx.t);
            indexMappingLines(render, layout, layout.idxObj, layout.tokEmbedObj, color, padTop, padBot, exampleTIdx, exampleTokIdx, 0.5);
        }

        if (layout.model && t7_iterCols.t < 1.0) {
            hideFromBlock(render, layout, layout.residual0);
        }

        if (layout.model && t5_iter1Col.t > 0.0 && t6_cleanup1.t <= 0.0) {
            let sub = findSubBlocks(layout.residual0, Dim.X, exampleTIdx, exampleTIdx)[0];
            if (sub) {
                sub.access = { ...sub.access!, src: layout.model.vocabEmbed.output, disable: false };
                let yPos = t5_iter1Col.t * sub.cy;
                let yIdx = Math.floor(yPos);
                if (yIdx < sub.cy) {
                    addSourceDestCurveLine(render, layout, layout.tokEmbedObj, layout.residual0, new Vec3(exampleTokIdx, yIdx, 0), new Vec3(exampleTIdx, yIdx, 0), new Vec4(1,0,0,1));
                    drawThread(render.threadRender, layout, sub, Dim.Y, 0, 0, 1, yIdx + 1, new Vec4(1,0,0,1));
                    drawThread(render.threadRender, layout, layout.tokEmbedObj, Dim.Y, exampleTokIdx, 0, 1, yIdx + 1, new Vec4(1,0,0,1));
                    drawThread(render.threadRender, layout, layout.posEmbedObj, Dim.Y, exampleTIdx, 0, 1, yIdx + 1, new Vec4(1,0,0,1));
                }

                splitGridX(layout, sub, Dim.Y, yPos, 0.0);

                for (let vertSubBelow of findSubBlocks(sub, Dim.Y, Math.floor(yPos) + 1, null)) {
                    vertSubBelow.access = { ...sub.access, disable: true };
                }
            }
        }

        if (layout.model && t7_iterCols.active) {
            let T = layout.idxObj.cx;
            let C = layout.residual0.cy;

            let tPos = t7_iterCols.t * T;
            let tIdx = Math.floor(tPos);

            let t_inner = tPos - tIdx;
            let cPos = t_inner * C;

            let tokIdx = layout.model.inputBuf[tIdx];

            render.tokenColors = { color2: dimStyleColor(DimStyle.n_vocab), mixes: oneHotArray(T, tIdx, 1.0) };

            splitGridX(layout, layout.residual0, Dim.X, tIdx + 0.5, 0.0);

            let sub = findSubBlocks(layout.residual0, Dim.X, null, tIdx - 1);
            for (let vertSubLeft of sub) {
                vertSubLeft.access = { ...vertSubLeft.access!, disable: false };
            }
            let sub2 = findSubBlocks(layout.residual0, Dim.X, tIdx, tIdx)[0];
            if (sub2) {
                sub2.highlight = 0.2;
                sub2.access = { ...sub2.access!, disable: false };
                let yPos = cPos + 0.5;

                let yIdx = Math.floor(cPos);
                let curveColor = new Vec4(1,0,0,1).mul(0.3);
                addSourceDestCurveLine(render, layout, layout.tokEmbedObj, layout.residual0, new Vec3(tokIdx, yIdx, 0), new Vec3(tIdx, yIdx, 0), curveColor);
                addSourceDestCurveLine(render, layout, layout.posEmbedObj, layout.residual0, new Vec3(tIdx, yIdx, 0), new Vec3(tIdx, yIdx, 0), curveColor);

                drawThread(render.threadRender, layout, layout.residual0, Dim.Y, tIdx, 0, 1, yIdx + 1, new Vec4(1,0,0,1));
                drawThread(render.threadRender, layout, layout.tokEmbedObj, Dim.Y, tokIdx, 0, 1, yIdx + 1, new Vec4(1,0,0,1));
                drawThread(render.threadRender, layout, layout.posEmbedObj, Dim.Y, tIdx, 0, 1, yIdx + 1, new Vec4(1,0,0,1));

                splitGridX(layout, sub2, Dim.Y, yPos, 0.0);

                for (let colSubBelow of findSubBlocks(sub2, Dim.Y, Math.floor(cPos) + 1, null)) {
                    colSubBelow.access = { ...colSubBelow.access!, disable: true };
                }
            }


            let mixes = oneHotArray(layout.tokEmbedObj.cx, tokIdx, 1.0);
            renderIndexes(render, layout, layout.tokEmbedObj, embedOffColor, t3_showTokEmIdx.t, 3, 0, null, { color2: dimStyleColor(DimStyle.n_vocab), mixes });

            let padTop = layout.cell * 0.3;
            let padBot = layout.cell * 0.3 + 3;
            let color = dimStyleColor(DimStyle.n_vocab).mul(t3_showTokEmIdx.t);
            indexMappingLines(render, layout, layout.idxObj, layout.tokEmbedObj, color, padTop, padBot, tIdx, tokIdx, 0.5);

            let tokSub = splitGridX(layout, layout.tokEmbedObj, Dim.X, tokIdx + 0.5, 0);
            // let tokSub = findSubBlocks(layout.tokEmbedObj, Dim.X, tokIdx, tokIdx)[0];
            if (tokSub) {
                tokSub.highlight = 0.2;
            }

            let posSub = splitGridX(layout, layout.posEmbedObj, Dim.X, tIdx + 0.5, 0);
            // let posSub = findSubBlocks(layout.posEmbedObj, Dim.X, tIdx, tIdx)[0];
            if (posSub) {
                posSub.highlight = 0.2;
            }
        }

        // fallthrough to continue once the commentary is done
    } break;

    case Phase.LayerNorm1: {

        let t0_dissolveHeads = atTime(0, 1.0, 0.5);
        let t2_alignqkv = afterTime(t0_dissolveHeads, 1.0, 0.5);
        let t3_v_mm = afterTime(t2_alignqkv, 4);

        let targetHeadIdx = 2;
        let targetHead = layout.blocks[0].heads[targetHeadIdx];

        let block = layout.blocks[0];
        {
            for (let headIdx = 0; headIdx < block.heads.length; headIdx++) {
                if (headIdx == targetHeadIdx) {
                    continue;
                }
                for (let cube of block.heads[headIdx].cubes) {
                    cube.opacity = lerpSmoothstep(1.0, 0.0, t0_dissolveHeads.t);
                }
            }
        }

        {
            let headZ = targetHead.attnMtx.z;
            let targetHeadZ = block.ln1.lnResid.z;
            let deltaZ = lerpSmoothstep(0, (targetHeadZ - headZ), t2_alignqkv.t);
            for (let cube of targetHead.cubes) {
                cube.z += deltaZ;
            }
        }

        {
            let qkv = [
                [targetHead.qBlock, targetHead.qWeightBlock, targetHead.qBiasBlock],
                [targetHead.kBlock, targetHead.kWeightBlock, targetHead.kBiasBlock],
                [targetHead.vBlock, targetHead.vWeightBlock, targetHead.vBiasBlock],
            ];
            let targetZ = block.ln1.lnResid.z;
            let strideY = targetHead.qBlock.dy + layout.margin;
            let baseY = targetHead.qBlock.y;
            let qkvYPos = [0, -strideY, -strideY * 2];

            for (let i = 0; i < 3; i++) {
                let y = lerpSmoothstep(qkv[i][0].y, baseY + qkvYPos[i], t2_alignqkv.t);
                let z = lerpSmoothstep(qkv[i][0].z, targetZ, t2_alignqkv.t);
                for (let cube of qkv[i]) {
                    cube.y = y;
                    cube.z = z;
                }
            }

            let blockMidY = (blk: IBlkDef) => blk.y + blk.dy / 2;

            let resid0Idx = layout.cubes.indexOf(block.ln1.lnResid);
            let yDelta = lerpSmoothstep(0, blockMidY(block.ln1.lnResid) - blockMidY(targetHead.kBlock), t2_alignqkv.t);

            for (let i = 0; i < resid0Idx; i++) {
                let targetOpacity = 0.2;
                layout.cubes[i].opacity = lerpSmoothstep(1.0, targetOpacity, t2_alignqkv.t);
            }

            let afterAttn = false;
            for (let i = resid0Idx + 1; i < layout.cubes.length; i++) {
                let cube = layout.cubes[i];
                cube.y += yDelta;
                if (afterAttn) {
                    cube.opacity = Math.min(lerpSmoothstep(1.0, 0.2, t2_alignqkv.t), cube.opacity ?? 1.0);
                }
                afterAttn = afterAttn || cube === targetHead.vOutBlock;
            }
        }

        if (t3_v_mm.active) {
            let target = targetHead.vBlock;
            let xPos = t3_v_mm.t * target.cx;
            let xIdx = Math.floor(xPos);
            let yPos = (xPos - xIdx) * target.cy;
            let yIdx = Math.floor(yPos);

            let deps = target.deps;
            if (deps) {

                if (deps.dot) {
                    let srcA = deps.dot[0].src;
                    let srcB = deps.dot[1].src;
                    // need to figure out what i stands for
                    let dotLength = deps.dotLen!;

                    // let zPos = (yPos - yIdx) * dotLength;
                    // let zIdx = Math.floor(zPos);

                    let srcIdx0Mat = deps.dot[0].srcIdx;
                    let srcIdx1Mat = deps.dot[1].srcIdx;

                    let dotDim0 = srcIdx0Mat.g(0, 3) === 1 ? Dim.Y : Dim.X;
                    let dotDim1 = srcIdx1Mat.g(0, 3) === 1 ? Dim.Y : Dim.X;

                    let srcIdxA = deps.dot[0].srcIdx.mulVec4(new Vec4(xIdx, yIdx, 0, dotLength / 2));
                    let srcIdxB = deps.dot[1].srcIdx.mulVec4(new Vec4(xIdx, yIdx, 0, dotLength / 2));

                    let split = 0.0;

                    let srcADotDimIdx = srcIdxA.getIdx(dotDim0);
                    splitGridX(layout, srcA, dotDim0, srcADotDimIdx, 0);
                    let sub0 = findSubBlocks(srcA, dotDim0, srcADotDimIdx, srcADotDimIdx)[0];
                    if (sub0) sub0.highlight = 0.3;

                    let srcBDotDimIdx = srcIdxB.getIdx(dotDim1);
                    splitGridX(layout, srcB, dotDim1, srcBDotDimIdx, split);
                    let sub1 = findSubBlocks(srcB, dotDim1, srcBDotDimIdx, srcBDotDimIdx)[0];
                    if (sub1) sub1.highlight = 0.3;

                    // addSourceDestCurveLine(state, layout, srcA, target, new Vec3(srcIdxA.x, srcIdxA.y), new Vec3(xIdx, yIdx, 0), new Vec4(1,0,0,1).mul(0.3));
                    // addSourceDestCurveLine(state, layout, srcB, target, new Vec3(srcIdxB.x, srcIdxB.y), new Vec3(xIdx, yIdx, 0), new Vec4(1,0,0,1).mul(0.3));

                    splitGridX(layout, target, Dim.X, xPos, split);
                    let sub2 = findSubBlocks(target, Dim.X, xIdx, xIdx)[0];
                    if (sub2) {
                        sub2.highlight = 0.3;
                        splitGridX(layout, sub2, Dim.Y, yPos, 0);
                        let sub3 = findSubBlocks(sub2, Dim.Y, yIdx, yIdx)[0];
                        if (sub3) { sub3.highlight = 0.7; }

                    }
                }

            }
        }


    } break;

    }
}
