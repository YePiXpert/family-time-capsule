import Link from "next/link";
import { notFound } from "next/navigation";
import { BookPreview } from "@/components/book-preview";
import { getBookVersion, BookError } from "@/lib/books/projects/service";
import { requireFamily } from "@/lib/family/context";
export const dynamic='force-dynamic';
export default async function BookVersionPage({params}:{params:Promise<{id:string;revision:string}>}){
  const context=await requireFamily(),{id,revision}=await params;
  if(!/^\d+$/.test(revision))notFound();
  let book;
  try{book=getBookVersion(context,id,Number(revision));}catch(e){if(e instanceof BookError&&e.status===404)notFound();throw e;}
  return <main className="page-container"><Link className="ui-text-link" href={`/books/${id}`}>返回当前作品</Link><h1 className="mt-4 text-2xl">保存版本 · 修订 {revision}</h1><BookPreview book={book}/></main>;
}
