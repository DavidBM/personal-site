import {preparePipelines} from './pipeline-preparation.mjs';

/** Keep the normal single dispatch; retry this known native-compiler rejection
 * once with smaller shaders. Validation/source errors and unrelated jobs fail.
 */
export async function prepareAdvancePipeline(compile, onTiming=()=>{}) {
  try { return {pipeline:await compile('advance',false),prepare:null}; }
  catch(error) {
    if(error?.name!=='GPUPipelineError'||!/GPUCompu(?:t)?ePipeline could not compile/.test(error.message))throw error;
    const [prepare,pipeline]=await preparePipelines([
      {label:'advance split: events',run:()=>compile('prepareAdvance',true)},
      {label:'advance split: movement',run:()=>compile('advance',true)}
    ],1,onTiming);
    return {pipeline,prepare};
  }
}
