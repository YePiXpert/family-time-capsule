import { expect, it } from "vitest";
import { focusedImageFrame } from "../src/books/image-frame";
it("keeps a selected subject centered and clamps cropping at each edge", () => {
  expect(focusedImageFrame(1000, 500, 200, 200, {x:0.3,y:0.5})).toEqual({width:400,height:200,left:-20,top:-0});
  expect(focusedImageFrame(1000, 500, 200, 200, {x:0,y:0})).toMatchObject({left:-0,top:-0});
  expect(focusedImageFrame(1000, 500, 200, 200, {x:1,y:1})).toMatchObject({left:-200,top:-0});
  expect(focusedImageFrame(500,1000,200,200,{x:0.5,y:1})).toMatchObject({left:-0,top:-200});
  expect(focusedImageFrame(0,500,200,200,{x:0.5,y:0.5})).toBeNull();
});
