import {hc} from "hono/client";
import type {AppType} from "@nightcode/server"; 
import { clearAuth, getAuth } from "./auth";


export const apiClient = hc<AppType>(
    process.env.API_URL ?? "http://localhost:3000",
    {
        //input — адреса, куди йде запит, наприклад "http://localhost:3000/sessions". init — налаштування запиту: метод (GET/POST), заголовки, тіло (наприклад, JSON нової сесії).
        // Додає токен в Authorization і скидає auth, якщо сервер повернув 401.
        // [0] [1] - типи першого та другого елементу, тип input такий самий, як тип першого аргументу fetch», і так само для init
        fetch: async(
            input: Parameters<typeof fetch>[0], 
            init?: Parameters<typeof fetch>[1]
            ) => {
            const headers = new Headers(init?.headers);
            const auth = getAuth();

            if(auth){
                headers.set("Authorization", `Bearer ${auth.token}`);
            }

            const response = await fetch(input, {...init, headers});
            if(response.status === 401){
                clearAuth();
            }

            return response;
        }
    }
);

