type ErrorResponse ={
    json: ()=> Promise<unknown>;
    status: number;
    statusText: string;
};

export async function getErrorMessage(response: ErrorResponse){
    try{
        const data = (await response.json()) as {error?: string}
        if(typeof data.error==="string" && data.error.length>0){
            return data.error;
        }
    } catch{
    // Ignore invalid error payloads and fall back to the status textbelow.
    }

    return response.statusText || `Request failed ith status ${response.status}`;
};